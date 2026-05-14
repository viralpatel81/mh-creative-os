// Verifies the Runtime emits step.start and step.end events for every
// workflow step when an event sink is injected. Sibling file to
// runtime.test.ts to avoid interfering with its broader env setup.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createRuntime } from './runtime.js'
import { EventRecorder } from './test-harness.js'
import { writeBrandFixture } from '../test-fixtures.js'

const IMAGE_API_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY']
const roots: string[] = []

function suppressImageApiKeys(): void {
  for (const key of IMAGE_API_KEYS) {
    delete process.env[key]
  }
}

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'loom-events-'))
  roots.push(root)
  writeBrandFixture(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true })
  }
})

describe('Runtime event emission', () => {
  test('emits one step.start + one step.end per workflow step', async () => {
    const root = createWorkspace()
    suppressImageApiKeys()
    const recorder = new EventRecorder()
    const runtime = createRuntime({ root, eventSink: recorder })

    const run = await runtime.runWorkflow({
      workflow: 'social.post',
      brand: 'givecare',
      input: { topic: 'event-test' },
      autoApprove: true,
    })

    const starts = recorder.events.filter((e) => e.kind === 'step.start')
    const ends = recorder.events.filter((e) => e.kind === 'step.end')

    expect(starts.length).toBeGreaterThan(0)
    expect(starts.length).toBe(ends.length)
    for (const e of starts) {
      if (e.kind === 'step.start') expect(e.runId).toBe(run.id)
    }
    for (const e of ends) {
      if (e.kind === 'step.end') {
        expect(e.runId).toBe(run.id)
        expect(typeof e.durationMs).toBe('number')
        expect(e.durationMs).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('emits artifact.written for every persisted artifact during a run', async () => {
    const root = createWorkspace()
    suppressImageApiKeys()
    const recorder = new EventRecorder()
    const runtime = createRuntime({ root, eventSink: recorder })

    const run = await runtime.runWorkflow({
      workflow: 'social.post',
      brand: 'givecare',
      input: { topic: 'artifact-event-test' },
      autoApprove: true,
    })

    const artifactEvents = recorder.events.filter((e) => e.kind === 'artifact.written')
    expect(artifactEvents.length).toBeGreaterThan(0)
    for (const e of artifactEvents) {
      if (e.kind === 'artifact.written') {
        expect(e.runId).toBe(run.id)
        expect(e.type).toBeTruthy()
        expect(e.path).toBeTruthy()
      }
    }
  })
})
