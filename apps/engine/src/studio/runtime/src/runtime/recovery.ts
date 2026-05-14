// Startup recovery — sweeps stale `running` rows whose started_at is older
// than a threshold and marks them as `failed`. Runs once when the engine
// boots; the daemon ensures only one engine subprocess writes the DB at a
// time, so we don't need cross-process locks.
//
// Why this exists: engine subprocesses are one-shot per workflow run
// (spawned by the daemon). If a subprocess crashes mid-run, the SQLite row
// stays in `running` forever — CLI inspections show stale state and the
// daemon can't tell whether the row is live or orphaned. startupRecovery
// runs at every Runtime construction (see auto-recover wiring) and reaps
// anything that's older than `staleAfterMs`.

import type { DatabaseSync } from 'node:sqlite'

export interface RecoveryOptions {
  /** Rows in `running` with `started_at` older than now-staleAfterMs are reaped. */
  staleAfterMs: number
}

export interface RecoveryResult {
  /** IDs of runs transitioned from `running` to `failed`. */
  failed: string[]
}

export function startupRecovery(db: DatabaseSync, opts: RecoveryOptions): RecoveryResult {
  const cutoff = new Date(Date.now() - opts.staleAfterMs).toISOString()
  const stale = db
    .prepare(
      `SELECT id FROM runs WHERE status='running' AND started_at IS NOT NULL AND started_at < ?`,
    )
    .all(cutoff) as Array<{ id: string }>

  const failed: string[] = []
  const now = new Date().toISOString()
  for (const row of stale) {
    db.prepare(
      `UPDATE runs SET status='failed', error_message=?, finished_at=?, updated_at=? WHERE id=?`,
    ).run('engine_crash (stale running row reaped on startup)', now, now, row.id)
    failed.push(row.id)
  }
  return { failed }
}
