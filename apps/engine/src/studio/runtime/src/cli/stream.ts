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
