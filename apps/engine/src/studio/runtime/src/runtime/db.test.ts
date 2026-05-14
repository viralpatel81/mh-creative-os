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
})
