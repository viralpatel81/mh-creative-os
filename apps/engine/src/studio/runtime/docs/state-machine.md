# Studio Runtime — Durability + Event Emitter

This is the engine's internal contract for the open-design daemon that
spawns it. The daemon owns its own `.od/app.sqlite`; this document is
strictly about `state/loom.sqlite` and the JSONL event stream agentcy
emits on stdout when invoked with `--stream-events`.

## Status transitions

```
                 ┌────────────────────────────┐
                 │                            │
queued ───► running ───► (in_review ─► approved | rejected)
                 │
                 ├──► failed         (step.run() threw)
                 │
                 ├──► failed         (engine_crash, reaped on next startup)
                 │
                 └──► published      (after publish step succeeds)
```

Statuses persisted in `runs.status`; enforced via a `CHECK` constraint
on the column. The eight legal values are:

```
queued · running · in_review · approved · rejected · failed · published · cancelled
```

## DB pragmas

`openRuntimeDb()` sets four PRAGMAs on every connection:

| PRAGMA | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | concurrent reads from CLI inspections while engine writes |
| `busy_timeout` | `5000` | wait up to 5s on lock contention instead of erroring |
| `synchronous` | `NORMAL` | durability OK; full COMMIT fsync only on WAL checkpoint |
| `foreign_keys` | `ON` | referential integrity for run_id linkage |

## Event union

`RuntimeEvent` (`src/runtime/events.ts`):

- `step.start { runId, step }` — emitted before each step's `.run()` is awaited
- `step.end { runId, step, durationMs }` — after outputs are persisted
- `artifact.written { runId, type, path, identifier?, title? }` — after every artifact insert
- `log { runId, level, message }` — explicit logs (reserved; not yet emitted from runtime)
- `run.failed { runId, step, error }` — emitted in catch before re-throw

## Sinks

`RuntimeEventSink` (`src/runtime/events.ts`):

- `NoopSink` — default; swallows every event
- `MultiSink([...])` — fan out to multiple sinks
- `JsonlStreamSink(out)` — `src/cli/stream.ts`; one JSON object per line on the provided Writable

## CLI usage

```bash
agentcy studio run social.post --brand givecare --topic "foo" --stream-events
```

With `--stream-events`, stdout becomes a line-delimited JSON event stream
suitable for the open-design daemon's `agentcy-parser`. Without the flag,
the runtime falls back to `NoopSink` and the CLI emits its normal final
summary. Sample output:

```jsonl
{"kind":"step.start","runId":"run_xxx","step":"signal"}
{"kind":"artifact.written","runId":"run_xxx","type":"signal_packet","path":"…"}
{"kind":"step.end","runId":"run_xxx","step":"signal","durationMs":2}
{"kind":"step.start","runId":"run_xxx","step":"brief"}
...
```

## Outbox

`src/runtime/outbox.ts` exposes `writeArtifactViaOutbox(db, input)` for
byte payloads where the crash window matters (PNG, MP4, etc.):

```
insert pending ─► write staging ─► rename to final ─► mark committed
                              │
                              └─ crash here: reconcileOutbox() picks it up
```

`reconcileOutbox(db)` sweeps any `pending` rows:

- staging file present → rename + mark committed
- staging gone, final present → mark committed (crashed after rename, before update)
- neither → mark failed

The existing `runtime.writeArtifact` keeps inline JSON metadata writes;
outbox is opt-in for binary artifacts.

## Recovery

`src/runtime/recovery.ts::startupRecovery(db, { staleAfterMs })` reaps
any `running` row whose `started_at` is older than the threshold and
marks it `failed` with `error_message='engine_crash...'`. Rows with null
`started_at` are intentionally left alone.

`Runtime` calls `startupRecovery` + `reconcileOutbox` automatically when
constructed unless `autoRecover: false` is passed. Default threshold:
`60_000` ms.

```typescript
new Runtime({ root })                                      // auto-recover with 60s threshold
new Runtime({ root, autoRecover: { staleAfterMs: 10_000 } }) // tighter threshold
new Runtime({ root, autoRecover: false })                  // skip (tests only)
```

## Backward compatibility

`Runtime.runWorkflow(input)` keeps its public signature unchanged. With
no event sink and no stream-events flag, the runtime behaves exactly as
it did before this work landed. The new capabilities are strictly
additive.

## Cross-process posture

This document covers engine-internal state only. Daemon-side run
queueing, claim semantics, and SSE forwarding live in `apps/daemon/`.
The engine's DB (`state/loom.sqlite`) is never opened by the daemon, and
the daemon's DB (`.od/app.sqlite`) is never opened by the engine. Tests
of either side run independently.
