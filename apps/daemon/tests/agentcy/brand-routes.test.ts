// E3.3.a — Brand profile read endpoints.
//
// Coverage:
//   - GET /api/agentcy/brands: lists only ids that have a brand.md
//     and skips ones that don't; sorted ascending.
//   - GET /api/agentcy/brands/:id: returns the full BrandProfile JSON
//     including mh2 extension fields (photography_direction etc).
//   - 404 when no brand exists for the id.
//   - 400 when the id is path-like (defense against traversal).
//   - 422 when brand.md exists but is malformed YAML.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import express from 'express'
import type { Express } from 'express'

import { registerAgentcyBrandRoutes } from '../../src/agentcy/index.js'

interface Harness {
  baseUrl: string
  cleanup: () => void
  engineRoot: string
}

function writeBrand(brandsDir: string, id: string, frontmatter: string): void {
  const dir = join(brandsDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'brand.md'), `---\n${frontmatter}\n---\n\nBody.\n`)
}

async function startHarness(): Promise<Harness> {
  const engineRoot = mkdtempSync(join(tmpdir(), 'mh-brand-routes-'))
  const brandsDir = join(engineRoot, 'brands')
  mkdirSync(brandsDir, { recursive: true })

  // Two brands with valid frontmatter, one with no brand.md, one with
  // bad YAML.
  writeBrand(
    brandsDir,
    'givecare',
    [
      'id: givecare',
      'name: GiveCare',
      'positioning: caregiver support',
      'voice_adjectives:',
      '  - warm',
      '  - direct',
      'photography_direction:',
      '  lighting: soft daylight',
      '  mood: hopeful',
    ].join('\n'),
  )
  writeBrand(brandsDir, 'scty', ['id: scty', 'name: Society'].join('\n'))
  // No brand.md — should be skipped in the list endpoint.
  mkdirSync(join(brandsDir, 'no-brand-md'), { recursive: true })
  // Malformed YAML — listed only if the loader succeeds; detail 422s.
  mkdirSync(join(brandsDir, 'broken'), { recursive: true })
  writeFileSync(
    join(brandsDir, 'broken', 'brand.md'),
    '---\nid: broken\nname: [unterminated\n---\n',
  )

  const app: Express = express()
  app.use(express.json())
  registerAgentcyBrandRoutes(app, {
    engine: {
      engineRoot,
      artifactsDir: join(engineRoot, 'state', 'artifacts'),
      cliCommand: '/usr/bin/false',
      cliBaseArgs: [],
    },
  })
  const server = await new Promise<ReturnType<Express['listen']>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    engineRoot,
    cleanup: () => {
      server.close()
      rmSync(engineRoot, { recursive: true, force: true })
    },
  }
}

let h: Harness

beforeAll(async () => {
  h = await startHarness()
})

afterAll(() => {
  h.cleanup()
})

describe('GET /api/agentcy/brands', () => {
  it('lists only brand dirs that have a brand.md, sorted by id', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { brands: Array<{ id: string; name: string }> }
    // 'broken' has malformed yaml → loadBrandProfile throws → skipped.
    // 'no-brand-md' has no brand.md → skipped at dir scan.
    // Remaining: givecare, scty.
    expect(body.brands.map((b) => b.id)).toEqual(['givecare', 'scty'])
    expect(body.brands.find((b) => b.id === 'givecare')?.name).toBe('GiveCare')
  })

  it('returns an empty list when the brands dir is missing', async () => {
    // Spin up a separate harness with no brands dir.
    const engineRoot = mkdtempSync(join(tmpdir(), 'mh-brand-empty-'))
    try {
      const app = express()
      registerAgentcyBrandRoutes(app, {
        engine: {
          engineRoot,
          artifactsDir: join(engineRoot, 'state', 'artifacts'),
          cliCommand: '/usr/bin/false',
          cliBaseArgs: [],
        },
      })
      const server = await new Promise<ReturnType<Express['listen']>>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s))
      })
      const { port } = server.address() as AddressInfo
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/agentcy/brands`)
        expect(r.status).toBe(200)
        const body = (await r.json()) as { brands: unknown[] }
        expect(body.brands).toEqual([])
      } finally {
        server.close()
      }
    } finally {
      rmSync(engineRoot, { recursive: true, force: true })
    }
  })
})

describe('GET /api/agentcy/brands/:id', () => {
  it('returns the full BrandProfile JSON including mh2 extension fields', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/givecare`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as Record<string, unknown>
    expect(body.id).toBe('givecare')
    expect(body.name).toBe('GiveCare')
    expect(body.positioning).toBe('caregiver support')
    expect(body.voice_adjectives).toEqual(['warm', 'direct'])
    expect(body.photography_direction).toEqual({
      lighting: 'soft daylight',
      mood: 'hopeful',
    })
  })

  it('404s when no brand.md exists for the id', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/no-brand-md`)
    expect(r.status).toBe(404)
  })

  it('404s for an unknown id', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/never-existed`)
    expect(r.status).toBe(404)
  })

  it('422s when brand.md exists but is malformed', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/broken`)
    expect(r.status).toBe(422)
    const body = (await r.json()) as { error: string }
    expect(body.error).toMatch(/yaml/i)
  })

  it('400s for a path-like id (traversal defense)', async () => {
    // 'foo.bar' has a dot, 'foo/bar' has a slash, 'foo\\bar' has a
    // backslash — all reach the handler (URL parser doesn't normalize
    // them away) and must be rejected before they're concatenated
    // into a filesystem path.
    for (const id of ['../etc', 'a/b', 'a.b', 'a\\b']) {
      const r = await fetch(`${h.baseUrl}/api/agentcy/brands/${encodeURIComponent(id)}`)
      expect(r.status, `id=${id}`).toBe(400)
    }
  })
})

describe('PUT /api/agentcy/brands/:id', () => {
  // Each PUT test seeds its own brand dir so the GET fixtures stay
  // pristine (vitest runs describe blocks in source order).
  function seedBrand(id: string, frontmatter: string, body = ''): string {
    const dir = join(h.engineRoot, 'brands', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'brand.md'), `---\n${frontmatter}\n---\n${body}`)
    return dir
  }

  it('writes the updated frontmatter back to brand.md and returns the round-tripped profile', async () => {
    seedBrand('write-basic', ['id: write-basic', 'name: Basic'].join('\n'))
    const updated = {
      id: 'write-basic',
      name: 'Basic',
      positioning: 'caregiver platform',
      voice_adjectives: ['warm', 'direct', 'curious'],
    }
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/write-basic`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updated),
    })
    expect(r.status).toBe(200)
    const echoed = (await r.json()) as Record<string, unknown>
    expect(echoed.positioning).toBe('caregiver platform')
    expect(echoed.voice_adjectives).toEqual(['warm', 'direct', 'curious'])
    // GET reflects the write.
    const after = (await fetch(`${h.baseUrl}/api/agentcy/brands/write-basic`).then((r) =>
      r.json(),
    )) as Record<string, unknown>
    expect(after.positioning).toBe('caregiver platform')
  })

  it('preserves the markdown body after the closing --- delimiter', async () => {
    seedBrand(
      'write-body',
      ['id: write-body', 'name: With Body'].join('\n'),
      '\nKeep this body across saves.\n',
    )
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/write-body`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'write-body', name: 'With Body', positioning: 'edited' }),
    })
    expect(r.status).toBe(200)
    const { readFileSync: read } = await import('node:fs')
    const after = read(join(h.engineRoot, 'brands', 'write-body', 'brand.md'), 'utf8')
    expect(after).toContain('Keep this body across saves.')
    expect(after).toContain('positioning: edited')
  })

  it('400s when body.id does not match URL :id', async () => {
    seedBrand('write-mismatch', ['id: write-mismatch', 'name: M'].join('\n'))
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/write-mismatch`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'someoneelse', name: 'X' }),
    })
    expect(r.status).toBe(400)
  })

  it('400s when body.name is missing', async () => {
    seedBrand('write-noname', ['id: write-noname', 'name: NN'].join('\n'))
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/write-noname`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'write-noname' }),
    })
    expect(r.status).toBe(400)
  })

  it('400s for non-object body', async () => {
    seedBrand('write-nonobj', ['id: write-nonobj', 'name: N'].join('\n'))
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/write-nonobj`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '"a string, not an object"',
    })
    expect(r.status).toBe(400)
  })

  it('404s when the brand.md does not exist', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/brands/never-existed`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'never-existed', name: 'X' }),
    })
    expect(r.status).toBe(404)
  })

  it('400s for path-like ids on PUT', async () => {
    for (const id of ['../etc', 'a/b', 'a.b']) {
      const r = await fetch(`${h.baseUrl}/api/agentcy/brands/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name: 'X' }),
      })
      expect(r.status, `id=${id}`).toBe(400)
    }
  })
})
