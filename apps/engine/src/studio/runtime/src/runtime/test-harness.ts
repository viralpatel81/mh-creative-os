// Test harness primitives for runtime durability + event-emitter tests.
// Lives alongside src/runtime/ so vitest's `src/**/*.test.ts` include picks
// up consumers; exported types are stable for cross-file test reuse.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RuntimeEvent, RuntimeEventSink } from './events.js'

/**
 * Writes the first `afterByteCount` bytes of `bytes` to `path`, then throws.
 * Used to simulate an engine crash mid-write so reconciler tests can assert
 * recovery from a partial staging file.
 */
export async function simulateCrashAfter(
  path: string,
  bytes: Buffer,
  afterByteCount: number,
): Promise<never> {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes.subarray(0, afterByteCount))
  throw new Error('crash injected')
}

/**
 * In-memory `RuntimeEventSink` that captures every emitted event in order.
 * Tests assert on `.events` after running a workflow with this sink injected.
 */
export class EventRecorder implements RuntimeEventSink {
  public readonly events: RuntimeEvent[] = []
  emit(event: RuntimeEvent): void {
    this.events.push(event)
  }
}
