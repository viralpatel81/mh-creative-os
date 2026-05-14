import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRuntimeDb } from './db.js'
import { reconcileOutbox, writeArtifactViaOutbox } from './outbox.js'

function insertRun(db: ReturnType<typeof openRuntimeDb>, runId: string): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO runs
       (id, workflow, brand, status, input_json, current_step, created_at, updated_at, attempts)
     VALUES (?, 'social.post', 'fixture', 'running', '{}', 'render', ?, ?, 0)`,
  ).run(runId, now, now)
}

describe('writeArtifactViaOutbox', () => {
  it('writes the bytes to the final path and marks the outbox row committed', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-outbox-write-'))
    try {
      const db = openRuntimeDb(root)
      insertRun(db, 'r1')

      const result = writeArtifactViaOutbox(db, {
        runId: 'r1',
        type: 'image/png',
        step: 'render',
        finalRelativePath: 'images/test.png',
        fileBytes: Buffer.from('fake-png'),
        data: { width: 100 },
        stagingDir: join(root, 'state', 'staging'),
        finalDir: join(root, 'state', 'artifacts'),
      })

      expect(existsSync(result.finalPath)).toBe(true)
      expect(readFileSync(result.finalPath).toString()).toBe('fake-png')
      // Staging file should have been renamed away.
      expect(existsSync(result.stagingPath)).toBe(false)

      const row = db
        .prepare('SELECT status FROM artifact_outbox WHERE id=?')
        .get(result.outboxId) as { status: string } | undefined
      expect(row?.status).toBe('committed')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('reconcileOutbox', () => {
  it('completes a pending row whose staging file still exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-outbox-recover-staging-'))
    try {
      const db = openRuntimeDb(root)
      insertRun(db, 'r1')

      const stagingDir = join(root, 'state', 'staging')
      const stagingPath = join(stagingDir, 'obx_stuck')
      const finalPath = join(root, 'state', 'artifacts', 'recovered.png')
      mkdirSync(stagingDir, { recursive: true })
      writeFileSync(stagingPath, 'recovered-bytes')

      db.prepare(
        `INSERT INTO artifact_outbox
           (id, run_id, type, step, staging_path, final_path, data_json, status, created_at)
         VALUES ('obx_stuck', 'r1', 'image/png', 'render', ?, ?, '{}', 'pending', ?)`,
      ).run(stagingPath, finalPath, new Date().toISOString())

      const result = reconcileOutbox(db)
      expect(result.committed).toContain('obx_stuck')
      expect(existsSync(finalPath)).toBe(true)
      expect(readFileSync(finalPath).toString()).toBe('recovered-bytes')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('marks a pending row committed when staging is gone but final landed', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-outbox-recover-final-'))
    try {
      const db = openRuntimeDb(root)
      insertRun(db, 'r1')

      const finalPath = join(root, 'state', 'artifacts', 'already-there.png')
      mkdirSync(join(root, 'state', 'artifacts'), { recursive: true })
      writeFileSync(finalPath, 'already-there')

      db.prepare(
        `INSERT INTO artifact_outbox
           (id, run_id, type, step, staging_path, final_path, data_json, status, created_at)
         VALUES ('obx_done', 'r1', 'image/png', 'render', ?, ?, '{}', 'pending', ?)`,
      ).run(join(root, 'no-such-staging'), finalPath, new Date().toISOString())

      const result = reconcileOutbox(db)
      expect(result.committed).toContain('obx_done')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('marks a pending row failed when neither staging nor final exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-outbox-recover-gone-'))
    try {
      const db = openRuntimeDb(root)
      insertRun(db, 'r1')

      db.prepare(
        `INSERT INTO artifact_outbox
           (id, run_id, type, step, staging_path, final_path, data_json, status, created_at)
         VALUES ('obx_gone', 'r1', 'image/png', 'render', ?, ?, '{}', 'pending', ?)`,
      ).run(
        join(root, 'no-staging'),
        join(root, 'no-final'),
        new Date().toISOString(),
      )

      const result = reconcileOutbox(db)
      expect(result.failed).toContain('obx_gone')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
