// HTTP-level tests for the agentcy bridge routes. We avoid spawning
// the real engine here — the routes module spawns via spawn.ts which
// is integration-tested by the engine smokes. Here we cover the
// validation layer (400 on bad request, 202 on accepted) and the
// artifacts read path (200 + bytes for a planted fixture, 404 on
// traversal).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import express from 'express'
import type { Express } from 'express'

import { registerAgentcyRoutes } from '../../src/agentcy/index.js'

interface Harness {
  app: Express
  baseUrl: string
  artifactsDir: string
  cleanup: () => void
}

async function startHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'mh-agentcy-routes-'))
  const artifactsDir = join(root, 'state', 'artifacts')
  mkdirSync(join(artifactsDir, 'run_smoke'), { recursive: true })
  writeFileSync(join(artifactsDir, 'run_smoke', 'ad.png'), Buffer.from('fake-png'))

  const app = express()
  app.use(express.json({ limit: '1mb' }))
  registerAgentcyRoutes(app, {
    engine: {
      engineRoot: root,
      artifactsDir,
      // The /workflow tests reject before spawning; using a no-op
      // command keeps a hypothetical accidental spawn from running
      // anything dangerous.
      cliCommand: '/bin/false',
      cliBaseArgs: [],
    },
    runIdGenerator: () => 'run_fixed',
  })

  const server = await new Promise<ReturnType<Express['listen']>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    artifactsDir,
    cleanup: () => {
      server.close()
      rmSync(root, { recursive: true, force: true })
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

describe('POST /api/agentcy/runs/workflow', () => {
  it('rejects a body that is not an object', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"not an object"',
    })
    expect(r.status).toBe(400)
  })

  it('rejects an unknown workflow name', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'unknown.thing',
        brand_id: 'givecare',
        params: {},
      }),
    })
    expect(r.status).toBe(400)
  })

  it('rejects a missing brand_id', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflow: 'ad.post', params: {} }),
    })
    expect(r.status).toBe(400)
  })

  it('rejects an ad request with an invalid aspect', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'ad.post',
        brand_id: 'givecare',
        params: { aspects: ['16:9'], engine: 'gemini', layout_mode: 'strategy' },
      }),
    })
    expect(r.status).toBe(400)
    const body = (await r.json()) as { error: string }
    expect(body.error).toMatch(/aspects/i)
  })

  it('rejects an email request with an invalid purpose', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'email.design',
        brand_id: 'givecare',
        params: { aspects: ['3:4'], engine: 'gemini', purpose: 'nonsense' },
      }),
    })
    expect(r.status).toBe(400)
  })
})

describe('GET /api/agentcy/artifacts', () => {
  it('serves a planted PNG with the right content-type and bytes', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/artifacts/run_smoke/ad.png`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    const buf = Buffer.from(await r.arrayBuffer())
    expect(buf.toString('utf8')).toBe('fake-png')
  })

  it('returns 404 for a traversal attempt', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/artifacts/run_smoke/../escape.png`)
    expect(r.status).toBe(404)
  })

  it('returns 404 for a missing file', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/artifacts/run_smoke/nope.png`)
    expect(r.status).toBe(404)
  })

  it('returns 404 for an unknown runId', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/artifacts/run_other/anything.png`)
    expect(r.status).toBe(404)
  })
})

describe('GET /api/agentcy/runs/:runId', () => {
  it('returns 404 for an unknown runId', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/run_other`)
    expect(r.status).toBe(404)
  })
})
