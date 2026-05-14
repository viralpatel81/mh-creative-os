import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoopSink, MultiSink, type RuntimeEvent, type RuntimeEventSink } from './events.js'
import { EventRecorder, simulateCrashAfter } from './test-harness.js'

describe('event sinks', () => {
  it('NoopSink swallows events without error', () => {
    const sink: RuntimeEventSink = new NoopSink()
    expect(() =>
      sink.emit({ kind: 'log', runId: 'r1', level: 'info', message: 'hi' }),
    ).not.toThrow()
  })

  it('MultiSink fans out to every child sink', () => {
    const a = new EventRecorder()
    const b = new EventRecorder()
    const sink = new MultiSink([a, b])
    const event: RuntimeEvent = { kind: 'step.start', runId: 'r1', step: 'draft' }
    sink.emit(event)
    expect(a.events).toEqual([event])
    expect(b.events).toEqual([event])
  })
})

describe('EventRecorder', () => {
  it('collects emitted events in order', () => {
    const rec = new EventRecorder()
    rec.emit({ kind: 'log', runId: 'r1', level: 'info', message: 'a' })
    rec.emit({ kind: 'log', runId: 'r1', level: 'info', message: 'b' })
    const messages = rec.events.map((e) => (e.kind === 'log' ? e.message : null))
    expect(messages).toEqual(['a', 'b'])
  })
})

describe('simulateCrashAfter', () => {
  it('writes the first N bytes to staging then throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-crash-'))
    try {
      const target = join(root, 'staging', 'partial.png')
      await expect(simulateCrashAfter(target, Buffer.from('abcdefghij'), 5)).rejects.toThrow(
        /crash injected/,
      )
      expect(existsSync(target)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
