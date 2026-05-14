import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import { JsonlStreamSink } from './stream.js'

describe('JsonlStreamSink', () => {
  it('writes one JSON line per event to the provided stream', () => {
    const out = new PassThrough()
    const chunks: string[] = []
    out.on('data', (c: Buffer) => chunks.push(c.toString('utf8')))

    const sink = new JsonlStreamSink(out)
    sink.emit({ kind: 'step.start', runId: 'r1', step: 'draft' })
    sink.emit({
      kind: 'artifact.written',
      runId: 'r1',
      type: 'image/png',
      path: '/p/x.png',
    })

    const lines = chunks.join('').trim().split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0])).toEqual({ kind: 'step.start', runId: 'r1', step: 'draft' })
    const second = JSON.parse(lines[1])
    expect(second.kind).toBe('artifact.written')
    expect(second.path).toBe('/p/x.png')
  })
})
