// E3.3.d — GET /api/agentcy/runs list endpoint tests.
//
// Seeds rows directly via the persistence helpers (faster + more
// deterministic than driving the full /workflow path) and queries the
// list endpoint with the filter combinations the dashboard will use:
// status set, single workflow, single brand, custom limit.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import express from 'express'
import type { Express } from 'express'
import Database from 'better-sqlite3'

import { registerAgentcyRoutes } from '../../src/agentcy/index.js'
import {
  finishRun,
  insertRun,
  migrateAgentcy,
} from '../../src/agentcy/persistence.js'

interface Harness {
  baseUrl: string
  db: Database.Database
  cleanup: () => void
}

async function startHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'mh-runs-list-'))
  const db = new Database(':memory:')
  // Pre-migrate so we can seed rows before registerAgentcyRoutes runs.
  // The route registration call migrates idempotently anyway.
  migrateAgentcy(db)
  const app: Express = express()
  app.use(express.json())
  registerAgentcyRoutes(app, {
    engine: {
      engineRoot: root,
      artifactsDir: join(root, 'state', 'artifacts'),
      cliCommand: '/usr/bin/false',
      cliBaseArgs: [],
    },
    db,
  })
  const server = await new Promise<ReturnType<Express['listen']>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    cleanup: () => {
      server.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

let h: Harness

beforeAll(async () => {
  h = await startHarness()
  // Seed five rows with mixed statuses, workflows, brands.
  insertRun(h.db, { runId: 'r1', workflow: 'ad.post', brandId: 'givecare', startedAt: 100 })
  insertRun(h.db, { runId: 'r2', workflow: 'email.design', brandId: 'givecare', startedAt: 200 })
  insertRun(h.db, { runId: 'r3', workflow: 'ad.post', brandId: 'scty', startedAt: 300 })
  insertRun(h.db, { runId: 'r4', workflow: 'popup.design', brandId: 'givecare', startedAt: 400 })
  insertRun(h.db, { runId: 'r5', workflow: 'ad.post', brandId: 'givecare', startedAt: 500 })
  // r1 succeeded, r2 failed, r3+r4+r5 still running.
  finishRun(h.db, { runId: 'r1', status: 'succeeded', exitCode: 0, signal: null, endedAt: 150 })
  finishRun(h.db, { runId: 'r2', status: 'failed', exitCode: 1, signal: null, endedAt: 250 })
})

afterAll(() => {
  h.cleanup()
})

describe('GET /api/agentcy/runs', () => {
  it('lists all runs newest-first by default', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { runs: Array<{ runId: string }> }
    expect(body.runs.map((r) => r.runId)).toEqual(['r5', 'r4', 'r3', 'r2', 'r1'])
  })

  it('filters by a single status', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs?status=running`)
    const body = (await r.json()) as { runs: Array<{ runId: string; status: string }> }
    expect(body.runs.map((r) => r.runId).sort()).toEqual(['r3', 'r4', 'r5'])
    for (const row of body.runs) expect(row.status).toBe('running')
  })

  it('filters by multiple statuses (comma-separated)', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs?status=succeeded,failed`)
    const body = (await r.json()) as { runs: Array<{ runId: string }> }
    expect(body.runs.map((r) => r.runId).sort()).toEqual(['r1', 'r2'])
  })

  it('filters by workflow', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs?workflow=ad.post`)
    const body = (await r.json()) as { runs: Array<{ runId: string }> }
    expect(body.runs.map((r) => r.runId).sort()).toEqual(['r1', 'r3', 'r5'])
  })

  it('filters by brand', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs?brand=scty`)
    const body = (await r.json()) as { runs: Array<{ runId: string }> }
    expect(body.runs.map((r) => r.runId)).toEqual(['r3'])
  })

  it('combines filters with AND semantics', async () => {
    const r = await fetch(
      `${h.baseUrl}/api/agentcy/runs?workflow=ad.post&brand=givecare&status=running`,
    )
    const body = (await r.json()) as { runs: Array<{ runId: string }> }
    expect(body.runs.map((r) => r.runId).sort()).toEqual(['r5'])
  })

  it('respects an explicit limit', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs?limit=2`)
    const body = (await r.json()) as { runs: Array<{ runId: string }> }
    expect(body.runs.length).toBe(2)
    expect(body.runs[0]!.runId).toBe('r5') // newest
  })

  it('400s on an unknown status value', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs?status=bogus`)
    expect(r.status).toBe(400)
  })

  it('400s on a non-numeric limit', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs?limit=abc`)
    expect(r.status).toBe(400)
  })

  it('returns each row with the expected dashboard fields', async () => {
    const r = await fetch(`${h.baseUrl}/api/agentcy/runs?status=succeeded`)
    const body = (await r.json()) as { runs: Array<Record<string, unknown>> }
    const row = body.runs[0]!
    expect(row.runId).toBe('r1')
    expect(row.workflow).toBe('ad.post')
    expect(row.brandId).toBe('givecare')
    expect(row.status).toBe('succeeded')
    expect(row.startedAt).toBe(100)
    expect(row.endedAt).toBe(150)
    expect(row.exitCode).toBe(0)
  })
})
