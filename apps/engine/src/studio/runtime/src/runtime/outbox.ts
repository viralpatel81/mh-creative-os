// Artifact outbox — durable write pattern for files that must survive a
// mid-write crash.
//
// Sequence:
//   1. Insert pending row in artifact_outbox (DB transaction)
//   2. Write bytes to a staging path
//   3. Rename to the final path
//   4. Mark outbox row 'committed'
//
// If we crash between 2 and 3, reconcileOutbox can finish the rename on
// next startup. If we crash between 3 and 4, reconcileOutbox detects the
// file is already at final and marks committed. If staging is missing and
// final never landed, the row is marked failed so callers can re-attempt.
//
// The existing writeArtifact (in runtime.ts) writes small JSON metadata
// inline; outbox is for larger artifact bytes (PNG, MP4, etc.) where the
// crash window matters.

import type { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface OutboxWriteInput {
  runId: string
  type: string
  step: string
  finalRelativePath: string
  fileBytes: Buffer
  data: Record<string, unknown>
  stagingDir: string
  finalDir: string
}

export interface OutboxWriteResult {
  outboxId: string
  stagingPath: string
  finalPath: string
}

export function writeArtifactViaOutbox(
  db: DatabaseSync,
  input: OutboxWriteInput,
): OutboxWriteResult {
  const outboxId = `obx_${randomUUID()}`
  const stagingPath = join(input.stagingDir, outboxId)
  const finalPath = join(input.finalDir, input.finalRelativePath)
  const now = new Date().toISOString()

  mkdirSync(dirname(stagingPath), { recursive: true })
  writeFileSync(stagingPath, input.fileBytes)

  db.prepare(
    `INSERT INTO artifact_outbox
       (id, run_id, type, step, staging_path, final_path, data_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    outboxId,
    input.runId,
    input.type,
    input.step,
    stagingPath,
    finalPath,
    JSON.stringify(input.data),
    now,
  )

  mkdirSync(dirname(finalPath), { recursive: true })
  renameSync(stagingPath, finalPath)

  db.prepare(`UPDATE artifact_outbox SET status='committed' WHERE id=?`).run(outboxId)

  return { outboxId, stagingPath, finalPath }
}

export interface ReconcileResult {
  committed: string[]
  failed: string[]
}

export function reconcileOutbox(db: DatabaseSync): ReconcileResult {
  const pending = db
    .prepare(
      `SELECT id, staging_path, final_path FROM artifact_outbox WHERE status='pending'`,
    )
    .all() as Array<{ id: string; staging_path: string; final_path: string }>

  const committed: string[] = []
  const failed: string[] = []

  for (const row of pending) {
    if (existsSync(row.staging_path)) {
      try {
        mkdirSync(dirname(row.final_path), { recursive: true })
        renameSync(row.staging_path, row.final_path)
        db.prepare(`UPDATE artifact_outbox SET status='committed' WHERE id=?`).run(row.id)
        committed.push(row.id)
      } catch {
        db.prepare(`UPDATE artifact_outbox SET status='failed' WHERE id=?`).run(row.id)
        failed.push(row.id)
      }
    } else if (existsSync(row.final_path)) {
      // We crashed between rename + DB update on the happy path; file is
      // already at its destination, just mark the row committed.
      db.prepare(`UPDATE artifact_outbox SET status='committed' WHERE id=?`).run(row.id)
      committed.push(row.id)
    } else {
      // Staging gone, final never landed — write is unrecoverable.
      db.prepare(`UPDATE artifact_outbox SET status='failed' WHERE id=?`).run(row.id)
      failed.push(row.id)
    }
  }
  return { committed, failed }
}
