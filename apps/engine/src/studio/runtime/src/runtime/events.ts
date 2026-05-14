// Runtime event emitter — surfaces step + artifact + failure transitions
// during a workflow run. The daemon's stream parser (apps/daemon/src/stream/
// agentcy-parser.ts) consumes a JSONL form of these events and forwards them
// to the web via SSE. The runtime itself is sink-agnostic: pass any
// RuntimeEventSink (NoopSink by default) into the Runtime constructor.

export type RuntimeEvent =
  | { kind: 'step.start'; runId: string; step: string }
  | { kind: 'step.end'; runId: string; step: string; durationMs: number }
  | {
      kind: 'artifact.written'
      runId: string
      type: string
      path: string
      identifier?: string
      title?: string
    }
  | { kind: 'log'; runId: string; level: 'info' | 'warn' | 'error'; message: string }
  | { kind: 'run.failed'; runId: string; step: string; error: string }

export interface RuntimeEventSink {
  emit(event: RuntimeEvent): void
}

/** Default sink. Silently drops every event. */
export class NoopSink implements RuntimeEventSink {
  emit(_event: RuntimeEvent): void {
    /* swallow */
  }
}

/** Fan out a single event to multiple sinks. */
export class MultiSink implements RuntimeEventSink {
  constructor(private readonly children: readonly RuntimeEventSink[]) {}
  emit(event: RuntimeEvent): void {
    for (const child of this.children) child.emit(event)
  }
}
