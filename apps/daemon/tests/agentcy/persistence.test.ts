// Unit tests for the agentcy durable run store.
//
// These run against an in-memory better-sqlite3 instance so they don't
// touch the daemon's .od/app.sqlite and stay isolated. Coverage targets
// the three things Codex flagged in Phase E v1: runs survive daemon
// restart, events replay by seq, recovery sweep reaps orphaned
// `running` rows.

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

import {
  appendEvent,
  finishRun,
  getRun,
  insertRun,
  listActiveRuns,
  migrateAgentcy,
  recoverOrphanedRuns,
  replayEvents,
  setRunPid,
  type SqliteDb,
} from '../../src/agentcy/persistence.js'

function freshDb(): SqliteDb {
  const db = new Database(':memory:')
  migrateAgentcy(db)
  return db
}

describe('migrateAgentcy', () => {
  it('creates the two tables on a fresh database', () => {
    const db = freshDb()
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toContain('agentcy_runs')
    expect(names).toContain('agentcy_run_events')
  })

  it('is idempotent (safe to call on every daemon boot)', () => {
    const db = freshDb()
    expect(() => migrateAgentcy(db)).not.toThrow()
    expect(() => migrateAgentcy(db)).not.toThrow()
  })
})

describe('insertRun + getRun', () => {
  let db: SqliteDb
  beforeEach(() => {
    db = freshDb()
  })

  it('persists and reads back the run', () => {
    insertRun(db, { runId: 'r1', workflow: 'ad.post', brandId: 'givecare', startedAt: 1000 })
    const run = getRun(db, 'r1')
    expect(run).not.toBeNull()
    expect(run!.runId).toBe('r1')
    expect(run!.workflow).toBe('ad.post')
    expect(run!.brandId).toBe('givecare')
    expect(run!.status).toBe('running')
    expect(run!.pid).toBeNull()
    expect(run!.endedAt).toBeNull()
  })

  it('returns null for an unknown id', () => {
    expect(getRun(db, 'never')).toBeNull()
  })

  it('rejects an unknown status via the CHECK constraint', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO agentcy_runs (run_id, workflow, brand_id, status, started_at)
           VALUES ('bad', 'ad.post', 'x', 'BOGUS', 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint/i)
  })
})

describe('setRunPid + finishRun', () => {
  it('updates pid and finalizes status / exit code / signal', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r1', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    setRunPid(db, 'r1', 4242)
    finishRun(db, {
      runId: 'r1',
      status: 'succeeded',
      exitCode: 0,
      signal: null,
      endedAt: 9999,
    })
    const run = getRun(db, 'r1')!
    expect(run.pid).toBe(4242)
    expect(run.status).toBe('succeeded')
    expect(run.exitCode).toBe(0)
    expect(run.endedAt).toBe(9999)
  })
})

describe('appendEvent + replayEvents', () => {
  it('assigns monotonically increasing seqs per run', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r1', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    const a = appendEvent(db, 'r1', { kind: 'step.start', runId: 'r1', step: 'render' })
    const b = appendEvent(db, 'r1', { kind: 'step.end', runId: 'r1', step: 'render', durationMs: 7 })
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(2)
  })

  it('isolates seq sequences across different runs', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r1', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    insertRun(db, { runId: 'r2', workflow: 'ad.post', brandId: 'b', startedAt: 2 })
    const a = appendEvent(db, 'r1', { kind: 'step.start', runId: 'r1', step: 'render' })
    const b = appendEvent(db, 'r2', { kind: 'step.start', runId: 'r2', step: 'render' })
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(1)
  })

  it('replays only events with seq > afterSeq, in order', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r1', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    appendEvent(db, 'r1', { kind: 'step.start', runId: 'r1', step: 'a' })
    appendEvent(db, 'r1', { kind: 'step.end', runId: 'r1', step: 'a', durationMs: 1 })
    appendEvent(db, 'r1', { kind: 'step.start', runId: 'r1', step: 'b' })

    const full = replayEvents(db, 'r1', 0)
    expect(full.map((e) => e.seq)).toEqual([1, 2, 3])

    const after1 = replayEvents(db, 'r1', 1)
    expect(after1.map((e) => e.seq)).toEqual([2, 3])
    const firstPayload = after1[0]?.payload as unknown as { step?: string } | undefined
    expect(firstPayload?.step).toBe('a')
  })

  it('CASCADEs event deletion when its run is removed', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r1', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    appendEvent(db, 'r1', { kind: 'log', runId: 'r1', level: 'info', message: 'hi' })
    db.exec(`PRAGMA foreign_keys = ON`)
    db.prepare(`DELETE FROM agentcy_runs WHERE run_id=?`).run('r1')
    expect(replayEvents(db, 'r1', 0)).toEqual([])
  })
})

describe('listActiveRuns', () => {
  it('returns queued + running rows in start order', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r-old', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    insertRun(db, { runId: 'r-new', workflow: 'ad.post', brandId: 'b', startedAt: 2 })
    insertRun(db, { runId: 'r-done', workflow: 'ad.post', brandId: 'b', startedAt: 3 })
    finishRun(db, {
      runId: 'r-done',
      status: 'succeeded',
      exitCode: 0,
      signal: null,
      endedAt: 4,
    })

    const active = listActiveRuns(db)
    expect(active.map((r) => r.runId)).toEqual(['r-old', 'r-new'])
  })
})

describe('recoverOrphanedRuns', () => {
  it('reaps running rows whose pid is not alive at boot', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r-orphan', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    setRunPid(db, 'r-orphan', 99999)
    insertRun(db, { runId: 'r-alive', workflow: 'ad.post', brandId: 'b', startedAt: 2 })
    setRunPid(db, 'r-alive', 1)

    const isAlive = (pid: number | null) => pid === 1
    const reaped = recoverOrphanedRuns(db, isAlive)
    expect(reaped).toEqual(['r-orphan'])

    const orphan = getRun(db, 'r-orphan')!
    expect(orphan.status).toBe('failed')
    expect(orphan.errorMessage).toMatch(/daemon_restart/)

    const alive = getRun(db, 'r-alive')!
    expect(alive.status).toBe('running')
  })

  it('reaps rows with null pid (insert succeeded but pid never recorded)', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r-nullpid', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    const reaped = recoverOrphanedRuns(db, () => false)
    expect(reaped).toEqual(['r-nullpid'])
    expect(getRun(db, 'r-nullpid')!.errorMessage).toMatch(/no pid recorded/)
  })

  it('does not touch terminal rows', () => {
    const db = freshDb()
    insertRun(db, { runId: 'r-done', workflow: 'ad.post', brandId: 'b', startedAt: 1 })
    finishRun(db, {
      runId: 'r-done',
      status: 'succeeded',
      exitCode: 0,
      signal: null,
      endedAt: 2,
    })
    const reaped = recoverOrphanedRuns(db, () => false)
    expect(reaped).toEqual([])
    expect(getRun(db, 'r-done')!.status).toBe('succeeded')
  })
})
