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
import Database from 'better-sqlite3'

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
  // Real spawn cwd — needed so the spawn doesn't fail with ENOENT on
  // the cwd before /bin/false has a chance to exit. (The native
  // workflow tests below DO reach the spawn path.)
  mkdirSync(join(root, 'src', 'studio', 'runtime'), { recursive: true })

  const db = new Database(':memory:')
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  registerAgentcyRoutes(app, {
    engine: {
      engineRoot: root,
      artifactsDir,
      // The /workflow tests reject before spawning; using a no-op
      // command keeps a hypothetical accidental spawn from running
      // anything dangerous.
      cliCommand: '/usr/bin/false',
      cliBaseArgs: [],
    },
    db,
    runIdGenerator: (() => {
      let n = 0
      return () => `run_fixed_${++n}`
    })(),
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

describe('POST /api/agentcy/runs/workflow — native agentcy workflows', () => {
  // The native workflows (social/blog/outreach/respond) don't have
  // v1 request schemas; the daemon should accept them and pass any
  // params through. We don't actually spawn the engine here — the
  // harness uses cliCommand:'/usr/bin/false' so spawn exits 1 immediately,
  // which means the run is recorded as failed but the request was
  // accepted (202).
  it('accepts social.post with topic + pillar params', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'social.post',
        brand_id: 'givecare',
        params: { topic: 'caregiver gap', pillar: 'care-economy', format: 'infographic' },
      }),
    })
    expect(r.status).toBe(202)
    const body = (await r.json()) as { runId: string; workflow: string }
    expect(body.workflow).toBe('social.post')
    expect(typeof body.runId).toBe('string')
  })

  it('accepts blog.post', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'blog.post',
        brand_id: 'givecare',
        params: { topic: 'policy reform' },
      }),
    })
    expect(r.status).toBe(202)
  })

  it('accepts outreach.touch', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'outreach.touch',
        brand_id: 'givecare',
        params: {},
      }),
    })
    expect(r.status).toBe(202)
  })

  it('accepts respond.reply', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'respond.reply',
        brand_id: 'givecare',
        params: {},
      }),
    })
    expect(r.status).toBe(202)
  })

  it('still rejects truly unknown workflow names', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'nonsense.kind',
        brand_id: 'givecare',
        params: {},
      }),
    })
    expect(r.status).toBe(400)
  })

  it('skips the strict ad/email/popup_request.v1 schema for native workflows', async () => {
    // social.post has no 'aspects' field, but the daemon would reject
    // an empty aspects array on ad.post. Confirm the validator gate
    // truly skips for native flows.
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'social.post',
        brand_id: 'givecare',
        params: { aspects: [] }, // would 400 on ad.post
      }),
    })
    expect(r.status).toBe(202)
  })
})
