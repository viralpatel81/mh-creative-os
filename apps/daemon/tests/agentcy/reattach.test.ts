// E3.1 — Reattach test for the agentcy bridge.
//
// Scenario: a previous daemon lifetime spawned an engine, recorded the
// pid + log_path, and crashed. A fresh daemon comes up:
//   - recoverOrphanedRuns reaps `running` rows whose pid is dead.
//   - For `running` rows whose pid IS alive, registerAgentcyRoutes
//     starts a tailer against the recorded log_path so events written
//     to the file (either before or after the daemon outage) get
//     ingested into agentcy_run_events + forwarded to live SSE clients.
//
// We don't need a real engine process — we just need a pid that passes
// our isAlive predicate, plus a file that the tailer can read. Both
// are easy to fake.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import express from 'express'
import type { Express } from 'express'
import Database from 'better-sqlite3'

import { registerAgentcyRoutes } from '../../src/agentcy/index.js'
import { insertRun, setRunPid, setRunLogPath, replayEvents } from '../../src/agentcy/persistence.js'

interface Harness {
  baseUrl: string
  close: () => Promise<void>
  db: Database.Database
  engineRoot: string
  logPath: string
}

async function startApp(args: {
  engineRoot: string
  logPath: string
  isAlive: (pid: number | null) => boolean
  db: Database.Database
}): Promise<Harness> {
  const app: Express = express()
  app.use(express.json())
  registerAgentcyRoutes(app, {
    engine: {
      engineRoot: args.engineRoot,
      artifactsDir: join(args.engineRoot, 'state', 'artifacts'),
      cliCommand: '/bin/false',
      cliBaseArgs: [],
    },
    db: args.db,
    isAlive: args.isAlive,
  })
  const server = await new Promise<ReturnType<Express['listen']>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
    db: args.db,
    engineRoot: args.engineRoot,
    logPath: args.logPath,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('agentcy reattach', () => {
  it('tails a pre-existing JSONL log on registration and appends events keyed by line_index', async () => {
    const engineRoot = mkdtempSync(join(tmpdir(), 'mh-reattach-'))
    try {
      const logDir = join(engineRoot, 'state', 'run-logs')
      mkdirSync(logDir, { recursive: true })
      const logPath = join(logDir, 'r-reattach.jsonl')

      // Two events already in the file (engine wrote them in the
      // previous daemon lifetime, before the crash).
      writeFileSync(
        logPath,
        [
          JSON.stringify({ kind: 'step.start', runId: 'r-reattach', step: 'render' }),
          JSON.stringify({
            kind: 'step.end',
            runId: 'r-reattach',
            step: 'render',
            durationMs: 5,
          }),
        ].join('\n') + '\n',
      )

      const db = new Database(':memory:')

      // Pre-seed the `running` row exactly as it would have existed at
      // crash time: pid + log_path recorded, status=running.
      // Note: migrateAgentcy runs inside registerAgentcyRoutes, so we
      // need to migrate first to be able to insert.
      const { migrateAgentcy } = await import('../../src/agentcy/persistence.js')
      migrateAgentcy(db)
      insertRun(db, {
        runId: 'r-reattach',
        workflow: 'ad.post',
        brandId: 'givecare',
        startedAt: 1,
      })
      setRunPid(db, 'r-reattach', 4242)
      setRunLogPath(db, 'r-reattach', logPath)

      // Fresh daemon lifetime — pid 4242 is "alive" per our predicate.
      let aliveFlag = true
      const harness = await startApp({
        engineRoot,
        logPath,
        isAlive: (pid) => pid === 4242 && aliveFlag,
        db,
      })
      try {
        // Give the tailer a couple of poll cycles to pick up both
        // pre-existing lines.
        let events = replayEvents(harness.db, 'r-reattach', 0)
        const deadline = Date.now() + 2000
        while (events.length < 2 && Date.now() < deadline) {
          await sleep(40)
          events = replayEvents(harness.db, 'r-reattach', 0)
        }
        expect(events.map((e) => e.payload.kind)).toEqual(['step.start', 'step.end'])

        // SSE replay (since run is still active, the response stays
        // open — abort once we have the replayed chunk).
        const ctrl = new AbortController()
        const sseResp = await fetch(`${harness.baseUrl}/api/agentcy/runs/r-reattach/events`, {
          headers: { Accept: 'text/event-stream' },
          signal: ctrl.signal,
        })
        const reader = sseResp.body!.getReader()
        const { value } = await reader.read()
        ctrl.abort()
        const chunk = new TextDecoder().decode(value)
        expect(chunk).toContain('event: step.start')
        expect(chunk).toContain('event: step.end')
        expect(chunk).toContain('"durationMs":5')

        // Append a third line to the file — the live tailer should
        // pick it up and append a new seq=3 row.
        appendFileSync(
          logPath,
          JSON.stringify({ kind: 'log', runId: 'r-reattach', level: 'info', message: 'tick' }) +
            '\n',
        )
        const deadline2 = Date.now() + 2000
        while (replayEvents(harness.db, 'r-reattach', 0).length < 3 && Date.now() < deadline2) {
          await sleep(40)
        }
        events = replayEvents(harness.db, 'r-reattach', 0)
        expect(events.length).toBe(3)
        expect(events[2]!.payload.kind).toBe('log')

        // Flip the predicate to dead — tailer should drain and finish
        // the run as `failed` (reattached_engine_exited).
        aliveFlag = false
        const deadline3 = Date.now() + 2000
        let status = 'running'
        while (status === 'running' && Date.now() < deadline3) {
          await sleep(40)
          const r = await fetch(`${harness.baseUrl}/api/agentcy/runs/r-reattach`).then((r) =>
            r.json(),
          )
          status = (r as { status: string }).status
        }
        expect(status).toBe('failed')
      } finally {
        aliveFlag = false
        await harness.close()
      }
    } finally {
      rmSync(engineRoot, { recursive: true, force: true })
    }
  })

  it('dedups across two registerAgentcyRoutes lifetimes on the same DB + log file', async () => {
    const engineRoot = mkdtempSync(join(tmpdir(), 'mh-reattach-dedup-'))
    try {
      const logDir = join(engineRoot, 'state', 'run-logs')
      mkdirSync(logDir, { recursive: true })
      const logPath = join(logDir, 'r-dedup.jsonl')
      writeFileSync(
        logPath,
        JSON.stringify({ kind: 'step.start', runId: 'r-dedup', step: 'a' }) + '\n',
      )

      const db = new Database(':memory:')
      const { migrateAgentcy } = await import('../../src/agentcy/persistence.js')
      migrateAgentcy(db)
      insertRun(db, { runId: 'r-dedup', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
      setRunPid(db, 'r-dedup', 5151)
      setRunLogPath(db, 'r-dedup', logPath)

      // Lifetime 1: alive → reattach → tailer ingests line 1.
      let alive1 = true
      const h1 = await startApp({
        engineRoot,
        logPath,
        isAlive: (pid) => pid === 5151 && alive1,
        db,
      })
      try {
        const deadline = Date.now() + 2000
        while (replayEvents(db, 'r-dedup', 0).length < 1 && Date.now() < deadline) {
          await sleep(40)
        }
        expect(replayEvents(db, 'r-dedup', 0).length).toBe(1)
      } finally {
        alive1 = false
        await h1.close()
      }

      // Reset run status to running so lifetime 2 reattaches again.
      db.prepare(
        `UPDATE agentcy_runs SET status='running', ended_at=NULL, error_message=NULL WHERE run_id='r-dedup'`,
      ).run()

      // Lifetime 2: alive again → reattach should re-read the same
      // file from start but NOT double-insert the existing line.
      let alive2 = true
      const h2 = await startApp({
        engineRoot,
        logPath,
        isAlive: (pid) => pid === 5151 && alive2,
        db,
      })
      try {
        await sleep(200) // let tailer poll a few times
        const stepStarts = replayEvents(db, 'r-dedup', 0).filter(
          (e) => e.payload.kind === 'step.start',
        )
        // Exactly one step.start across both lifetimes — the line-indexed
        // engine event was not double-inserted on reattach. (Daemon-
        // emitted `end` events have line_index=NULL and don't count.)
        expect(stepStarts.length).toBe(1)
      } finally {
        alive2 = false
        await h2.close()
      }
    } finally {
      rmSync(engineRoot, { recursive: true, force: true })
    }
  })
})
