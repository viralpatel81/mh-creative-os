// End-to-end durability test for the agentcy bridge: a run inserted
// into the DB by one registerAgentcyRoutes() lifetime must be visible
// to a fresh registerAgentcyRoutes() against the same DB. Plus the
// recovery sweep: an active run whose pid is unknown gets reaped on
// the second registration.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import express from 'express'
import Database from 'better-sqlite3'

import { registerAgentcyRoutes } from '../../src/agentcy/index.js'
import { insertRun, setRunPid, appendEvent } from '../../src/agentcy/persistence.js'

function startApp(db: Database.Database, artifactsDir: string, isAlive?: (pid: number | null) => boolean) {
  const app = express()
  app.use(express.json())
  registerAgentcyRoutes(app, {
    engine: {
      engineRoot: artifactsDir + '/..',
      artifactsDir,
      cliCommand: '/usr/bin/false',
      cliBaseArgs: [],
    },
    db,
    ...(isAlive ? { isAlive } : {}),
  })
  return app
}

async function listen(app: express.Express): Promise<{ baseUrl: string; close: () => void }> {
  const server = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => server.close(),
  }
}

describe('agentcy durability', () => {
  it('reads back a run inserted by a previous registerAgentcyRoutes lifetime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-durable-'))
    const db = new Database(':memory:')
    try {
      // Lifetime 1: register routes, seed a completed run.
      const _appA = startApp(db, join(root, 'state', 'artifacts'))
      insertRun(db, {
        runId: 'r_persistent',
        workflow: 'ad.post',
        brandId: 'givecare',
        startedAt: 100,
      })
      setRunPid(db, 'r_persistent', 4242)
      appendEvent(db, 'r_persistent', {
        kind: 'step.start',
        runId: 'r_persistent',
        step: 'render',
      })

      // Lifetime 2: brand-new app on the same DB. recoverOrphanedRuns
      // runs at registration. We tell it 4242 is NOT alive — so the
      // run should be reaped on this register.
      const appB = startApp(db, join(root, 'state', 'artifacts'), () => false)
      const { baseUrl, close } = await listen(appB)
      try {
        // Status snapshot reads from the durable row.
        const status = await fetch(`${baseUrl}/api/agentcy/runs/r_persistent`).then((r) => r.json())
        expect((status as { status: string }).status).toBe('failed')
        expect((status as { errorMessage: string }).errorMessage).toMatch(/daemon_restart/)

        // SSE replay returns the persisted event log (with the daemon-
        // emitted terminal `end` recorded by recovery NOT — recovery
        // only marks the run row, the event log is what was actually
        // emitted). A consumer reading after a terminal status ends
        // cleanly without any events here since we only seeded one
        // step.start before "restart".
        const sseResp = await fetch(`${baseUrl}/api/agentcy/runs/r_persistent/events`, {
          headers: { Accept: 'text/event-stream' },
        })
        const text = await sseResp.text()
        expect(text).toContain('event: step.start')
        expect(text).toContain('"step":"render"')
      } finally {
        close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('replays events from Last-Event-ID seq', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-replay-'))
    const db = new Database(':memory:')
    try {
      const app = startApp(db, join(root, 'state', 'artifacts'))
      const { baseUrl, close } = await listen(app)
      try {
        insertRun(db, { runId: 'r1', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
        appendEvent(db, 'r1', { kind: 'step.start', runId: 'r1', step: 'a' })
        appendEvent(db, 'r1', { kind: 'step.end', runId: 'r1', step: 'a', durationMs: 1 })
        appendEvent(db, 'r1', { kind: 'step.start', runId: 'r1', step: 'b' })

        // Open SSE with Last-Event-ID: 2 — we should only see seq 3 (b).
        // We then immediately destroy the underlying socket via abort
        // signal once we have the body.
        const ctrl = new AbortController()
        const resp = await fetch(`${baseUrl}/api/agentcy/runs/r1/events`, {
          headers: { 'Last-Event-ID': '2', Accept: 'text/event-stream' },
          signal: ctrl.signal,
        })
        const reader = resp.body!.getReader()
        const { value } = await reader.read()
        ctrl.abort()
        const chunk = new TextDecoder().decode(value)
        expect(chunk).toContain('id: 3')
        expect(chunk).toContain('"step":"b"')
        expect(chunk).not.toContain('"step":"a"')
      } finally {
        close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
