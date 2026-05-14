// JSONL event sink — one JSON object per line on a Writable stream.
// Used by the agentcy studio CLI when `--stream-events` is set, so the
// open-design daemon (apps/daemon/src/stream/agentcy-parser.ts) can
// parse stdout line-by-line and forward events to the web via SSE.

import type { Writable } from 'node:stream'
import type { RuntimeEvent, RuntimeEventSink } from '../runtime/events.js'

export class JsonlStreamSink implements RuntimeEventSink {
  constructor(private readonly out: Writable) {}
  emit(event: RuntimeEvent): void {
    this.out.write(JSON.stringify(event) + '\n')
  }
}

/**
 * Detects the `--stream-events` flag in a CLI argv slice and returns the
 * argv with that flag removed, plus a boolean indicating whether it was set.
 * Kept separate from the generic --flag parser in commands/* so individual
 * commands can opt into stream-events without parsing pollution.
 */
export function takeStreamEventsFlag(args: string[]): { streamEvents: boolean; args: string[] } {
  const filtered: string[] = []
  let streamEvents = false
  for (const arg of args) {
    if (arg === '--stream-events') {
      streamEvents = true
      continue
    }
    filtered.push(arg)
  }
  return { streamEvents, args: filtered }
}

/**
 * Build the event sink for a CLI invocation. When `streamEvents` is false,
 * returns undefined so the Runtime falls back to NoopSink. When true, wraps
 * the provided Writable (defaults to process.stdout) in a JsonlStreamSink.
 */
export function getCliEventSink(
  streamEvents: boolean,
  out: Writable = process.stdout,
): RuntimeEventSink | undefined {
  return streamEvents ? new JsonlStreamSink(out) : undefined
}
