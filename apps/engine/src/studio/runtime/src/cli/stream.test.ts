import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import { JsonlStreamSink, takeStreamEventsFlag, getCliEventSink } from './stream.js'

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

describe('takeStreamEventsFlag', () => {
  it('returns false and leaves args unchanged when --stream-events is absent', () => {
    const args = ['--brand', 'givecare', '--topic', 'x']
    const result = takeStreamEventsFlag(args)
    expect(result.streamEvents).toBe(false)
    expect(result.args).toEqual(['--brand', 'givecare', '--topic', 'x'])
  })

  it('returns true and strips --stream-events from args', () => {
    const args = ['--brand', 'givecare', '--stream-events', '--topic', 'x']
    const result = takeStreamEventsFlag(args)
    expect(result.streamEvents).toBe(true)
    expect(result.args).toEqual(['--brand', 'givecare', '--topic', 'x'])
  })
})

describe('getCliEventSink', () => {
  it('returns undefined when streamEvents=false', () => {
    expect(getCliEventSink(false)).toBeUndefined()
  })

  it('returns a JsonlStreamSink targeting the provided stream when streamEvents=true', () => {
    const out = new PassThrough()
    const chunks: string[] = []
    out.on('data', (c: Buffer) => chunks.push(c.toString('utf8')))

    const sink = getCliEventSink(true, out)
    expect(sink).toBeInstanceOf(JsonlStreamSink)
    sink!.emit({ kind: 'log', runId: 'r1', level: 'info', message: 'hi' })
    const lines = chunks.join('').trim().split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0]).message).toBe('hi')
  })
})
