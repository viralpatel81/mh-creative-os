import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRuntimeDb } from './db.js'
import { startupRecovery } from './recovery.js'

function insertRun(
  db: ReturnType<typeof openRuntimeDb>,
  args: { id: string; status: string; startedAt?: string | null },
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO runs
       (id, workflow, brand, status, input_json, current_step, created_at, updated_at, started_at, attempts)
     VALUES (?, 'social.post', 'fixture', ?, '{}', 'signal', ?, ?, ?, 0)`,
  ).run(args.id, args.status, now, now, args.startedAt ?? null)
}

describe('startupRecovery', () => {
  it('marks running rows whose started_at is older than staleAfterMs as failed', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-recover-stale-'))
    try {
      const db = openRuntimeDb(root)
      const oldStart = new Date(Date.now() - 60_000).toISOString()
      insertRun(db, { id: 'r-stale', status: 'running', startedAt: oldStart })

      const result = startupRecovery(db, { staleAfterMs: 30_000 })
      expect(result.failed).toContain('r-stale')

      const after = db.prepare('SELECT status, error_message FROM runs WHERE id=?').get('r-stale') as
        | { status: string; error_message: string | null }
        | undefined
      expect(after?.status).toBe('failed')
      expect(after?.error_message).toMatch(/engine_crash/i)
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not touch fresh running rows', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-recover-fresh-'))
    try {
      const db = openRuntimeDb(root)
      insertRun(db, {
        id: 'r-fresh',
        status: 'running',
        startedAt: new Date().toISOString(),
      })

      const result = startupRecovery(db, { staleAfterMs: 30_000 })
      expect(result.failed).not.toContain('r-fresh')

      const after = db.prepare('SELECT status FROM runs WHERE id=?').get('r-fresh') as
        | { status: string }
        | undefined
      expect(after?.status).toBe('running')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores running rows with null started_at (never claimed)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-recover-null-'))
    try {
      const db = openRuntimeDb(root)
      insertRun(db, { id: 'r-null', status: 'running', startedAt: null })

      const result = startupRecovery(db, { staleAfterMs: 1 })
      expect(result.failed).not.toContain('r-null')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Runtime constructor auto-recover', () => {
  it('reaps stale running rows when autoRecover is enabled (default)', async () => {
    const { createRuntime } = await import('./runtime.js')
    const root = mkdtempSync(join(tmpdir(), 'mh-auto-recover-'))
    try {
      // Seed a stale row directly via the DB before constructing the runtime.
      const setupDb = openRuntimeDb(root)
      const oldStart = new Date(Date.now() - 120_000).toISOString()
      insertRun(setupDb, { id: 'r-orphan', status: 'running', startedAt: oldStart })
      setupDb.close()

      // Constructing with autoRecover (default) should reap it.
      createRuntime({ root, autoRecover: { staleAfterMs: 30_000 } })

      const db = openRuntimeDb(root)
      const after = db.prepare('SELECT status FROM runs WHERE id=?').get('r-orphan') as
        | { status: string }
        | undefined
      expect(after?.status).toBe('failed')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves stale rows alone when autoRecover is false', async () => {
    const { createRuntime } = await import('./runtime.js')
    const root = mkdtempSync(join(tmpdir(), 'mh-no-auto-recover-'))
    try {
      const setupDb = openRuntimeDb(root)
      const oldStart = new Date(Date.now() - 120_000).toISOString()
      insertRun(setupDb, { id: 'r-keep', status: 'running', startedAt: oldStart })
      setupDb.close()

      createRuntime({ root, autoRecover: false })

      const db = openRuntimeDb(root)
      const after = db.prepare('SELECT status FROM runs WHERE id=?').get('r-keep') as
        | { status: string }
        | undefined
      expect(after?.status).toBe('running')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
