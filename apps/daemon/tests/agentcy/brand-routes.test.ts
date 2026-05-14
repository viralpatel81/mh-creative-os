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
      cliCommand: '/bin/false',
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
          cliCommand: '/bin/false',
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
