import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunStatus } from '../domain/types.js'
import { openRuntimeDb } from './db.js'

describe('RunStatus', () => {
  it('includes queued, running, and cancelled in addition to existing values', () => {
    const statuses: RunStatus[] = [
      'queued',
      'running',
      'in_review',
      'approved',
      'rejected',
      'failed',
      'published',
      'cancelled',
    ]
    expect(statuses.length).toBe(8)
  })
})

describe('openRuntimeDb', () => {
  it('opens DB in WAL mode with busy_timeout=5000ms', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-runtime-'))
    try {
      const db = openRuntimeDb(root)
      const journalMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      const busyTimeout = db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
      expect(journalMode.journal_mode).toBe('wal')
      expect(busyTimeout.timeout).toBe(5000)
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects inserting a run row with an unknown status (CHECK constraint)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-runtime-check-'))
    try {
      const db = openRuntimeDb(root)
      expect(() =>
        db.prepare(`
          INSERT INTO runs (id, workflow, brand, status, input_json, current_step, created_at, updated_at, attempts)
          VALUES ('r1', 'social.post', 'b1', 'BOGUS', '{}', 'signal', 'now', 'now', 0)
        `).run(),
      ).toThrow(/CHECK constraint/i)
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('has started_at, finished_at, attempts columns on runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-runtime-cols-'))
    try {
      const db = openRuntimeDb(root)
      const cols = (db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>).map(
        (c) => c.name,
      )
      expect(cols).toContain('started_at')
      expect(cols).toContain('finished_at')
      expect(cols).toContain('attempts')
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
