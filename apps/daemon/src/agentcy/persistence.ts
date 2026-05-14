// Durable run storage for the agentcy bridge.
//
// Adds two tables to the existing daemon database (`.od/app.sqlite`):
//
//   agentcy_runs        run lifecycle (id, workflow, brand, status,
//                       pid, exit code, start/end times, error)
//
//   agentcy_run_events  append-only JSON event log keyed by run_id.
//                       Indexed on (run_id, seq) so SSE clients can
//                       replay from a given seq (after a reconnect)
//                       in linear time.
//
// We don't touch the upstream open-design db.ts migrate() function;
// migrateAgentcy(db) is called by registerAgentcyRoutes once at daemon
// startup. This keeps every vendored upstream file unmodified except
// server.ts (which already imports the bridge from Phase E first cut).

import type Database from 'better-sqlite3'

import type { AgentcyRunStatus, AgentcyRuntimeEvent } from './types.js'

export type SqliteDb = Database.Database

export interface AgentcyRunRow {
  runId: string
  workflow: string
  brandId: string
  status: AgentcyRunStatus
  pid: number | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  signal: string | null
  errorMessage: string | null
}

export function migrateAgentcy(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agentcy_runs (
      run_id        TEXT PRIMARY KEY,
      workflow      TEXT NOT NULL,
      brand_id      TEXT NOT NULL,
      status        TEXT NOT NULL CHECK (status IN (
                      'queued','running','succeeded','failed','canceled'
                    )),
      pid           INTEGER,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER,
      exit_code     INTEGER,
      signal        TEXT,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agentcy_runs_status
      ON agentcy_runs(status) WHERE status IN ('queued','running');

    CREATE TABLE IF NOT EXISTS agentcy_run_events (
      run_id   TEXT NOT NULL,
      seq      INTEGER NOT NULL,
      ts       INTEGER NOT NULL,
      kind     TEXT NOT NULL,
      payload  TEXT NOT NULL,
      PRIMARY KEY (run_id, seq),
      FOREIGN KEY (run_id) REFERENCES agentcy_runs(run_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agentcy_events_run
      ON agentcy_run_events(run_id, seq);
  `)
}

function rowToRun(row: Record<string, unknown>): AgentcyRunRow {
  return {
    runId: row.run_id as string,
    workflow: row.workflow as string,
    brandId: row.brand_id as string,
    status: row.status as AgentcyRunStatus,
    pid: (row.pid as number | null) ?? null,
    startedAt: row.started_at as number,
    endedAt: (row.ended_at as number | null) ?? null,
    exitCode: (row.exit_code as number | null) ?? null,
    signal: (row.signal as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
  }
}

export function insertRun(
  db: SqliteDb,
  args: { runId: string; workflow: string; brandId: string; startedAt: number },
): void {
  db.prepare(
    `INSERT INTO agentcy_runs (run_id, workflow, brand_id, status, started_at)
     VALUES (?, ?, ?, 'running', ?)`,
  ).run(args.runId, args.workflow, args.brandId, args.startedAt)
}

export function setRunPid(db: SqliteDb, runId: string, pid: number | null): void {
  db.prepare(`UPDATE agentcy_runs SET pid=? WHERE run_id=?`).run(pid, runId)
}

export function finishRun(
  db: SqliteDb,
  args: {
    runId: string
    status: AgentcyRunStatus
    exitCode: number | null
    signal: string | null
    endedAt: number
    errorMessage?: string | null
  },
): void {
  db.prepare(
    `UPDATE agentcy_runs
       SET status=?, exit_code=?, signal=?, ended_at=?, error_message=?
     WHERE run_id=?`,
  ).run(
    args.status,
    args.exitCode,
    args.signal,
    args.endedAt,
    args.errorMessage ?? null,
    args.runId,
  )
}

export function getRun(db: SqliteDb, runId: string): AgentcyRunRow | null {
  const row = db
    .prepare(`SELECT * FROM agentcy_runs WHERE run_id=?`)
    .get(runId) as Record<string, unknown> | undefined
  return row ? rowToRun(row) : null
}

export function listActiveRuns(db: SqliteDb): AgentcyRunRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM agentcy_runs WHERE status IN ('queued','running') ORDER BY started_at`,
    )
    .all() as Array<Record<string, unknown>>
  return rows.map(rowToRun)
}

export function appendEvent(
  db: SqliteDb,
  runId: string,
  event: AgentcyRuntimeEvent,
): { seq: number } {
  const ts = Date.now()
  const result = db
    .prepare(
      `INSERT INTO agentcy_run_events (run_id, seq, ts, kind, payload)
       VALUES (
         ?,
         COALESCE((SELECT MAX(seq) FROM agentcy_run_events WHERE run_id = ?), 0) + 1,
         ?,
         ?,
         ?
       )
       RETURNING seq`,
    )
    .get(runId, runId, ts, event.kind, JSON.stringify(event)) as { seq: number }
  return result
}

export interface ReplayedEvent {
  seq: number
  ts: number
  kind: string
  payload: AgentcyRuntimeEvent
}

export function replayEvents(
  db: SqliteDb,
  runId: string,
  afterSeq = 0,
): ReplayedEvent[] {
  const rows = db
    .prepare(
      `SELECT seq, ts, kind, payload
         FROM agentcy_run_events
        WHERE run_id = ? AND seq > ?
        ORDER BY seq`,
    )
    .all(runId, afterSeq) as Array<{ seq: number; ts: number; kind: string; payload: string }>
  return rows.map((row) => ({
    seq: row.seq,
    ts: row.ts,
    kind: row.kind,
    payload: JSON.parse(row.payload) as AgentcyRuntimeEvent,
  }))
}

/**
 * Daemon-startup recovery — any `running` row whose pid is not alive at
 * boot is reaped to `failed`. Called once during registerAgentcyRoutes
 * before the bridge starts accepting new requests.
 *
 * Returns the run ids that were reaped, so the caller can log them.
 */
export function recoverOrphanedRuns(
  db: SqliteDb,
  isAlive: (pid: number | null) => boolean = defaultIsAlive,
): string[] {
  const orphans = listActiveRuns(db).filter((run) => !isAlive(run.pid))
  const now = Date.now()
  const reaped: string[] = []
  for (const run of orphans) {
    finishRun(db, {
      runId: run.runId,
      status: 'failed',
      exitCode: null,
      signal: null,
      endedAt: now,
      errorMessage:
        run.pid === null
          ? 'daemon_restart (no pid recorded)'
          : `daemon_restart (pid ${run.pid} not alive)`,
    })
    reaped.push(run.runId)
  }
  return reaped
}

function defaultIsAlive(pid: number | null): boolean {
  if (pid === null || pid === undefined || Number.isNaN(pid)) return false
  try {
    // process.kill with signal 0 doesn't kill; it throws ESRCH if the
    // pid doesn't exist. Returns true if signal sent successfully.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
