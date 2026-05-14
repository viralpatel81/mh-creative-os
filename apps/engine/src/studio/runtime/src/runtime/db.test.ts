import { describe, it, expect } from 'vitest'
import type { RunStatus } from '../domain/types.js'

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
