# apps/daemon/src/agentcy/

The agentcy bridge — a self-contained, additive surface that spawns the
agentcy engine, parses its JSONL events, and serves its artifact files
over HTTP. open-design's existing chat-shaped run lifecycle
(`apps/daemon/src/runs.ts` + `chat-routes.ts`) is **not** modified by
this module.

## Module layout

```
index.ts    exports registerAgentcyRoutes
types.ts    WorkflowRunRequest, AgentcyEngineLocation, AgentcyRuntimeEvent
spawn.ts    spawnAgentcy(input) + paramsToCliArgs helper
static.ts   resolveArtifactPath (path-traversal guards) + contentTypeFor
routes.ts   express handlers; in-memory run state for Phase E first cut
```

## HTTP surface

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/agentcy/runs/workflow` | `WorkflowRunRequest` JSON | `202` `{ runId, workflow, brandId }` or `400 { error }` |
| GET  | `/api/agentcy/runs/:runId` | — | `200` status snapshot or `404` |
| GET  | `/api/agentcy/runs/:runId/events` | — | SSE stream of RuntimeEvents + terminal `end` |
| GET  | `/api/agentcy/artifacts/:runId/:path*` | — | file bytes with strict path-traversal guards, or `404` |

### WorkflowRunRequest

```ts
{
  workflow: 'ad.post' | 'email.design' | 'popup.design',
  brand_id: string,
  params: Record<string, unknown> // validated against the workflow's
                                  // *_request.v1 schema in @mh/protocols
}
```

`params` is folded into `{ brand_id, ...params }` and validated against
`ad_request.v1` / `email_request.v1` / `popup_request.v1`. Any extra or
malformed field returns `400` before the engine is spawned.

### RuntimeEvent envelope (SSE)

Each event in the stream is shaped like the engine's `RuntimeEvent`
(see `apps/engine/.../runtime/events.ts`):

```jsonl
{"kind":"step.start","runId":"...","step":"render"}
{"kind":"artifact.written","runId":"...","type":"ad_output","path":"..."}
{"kind":"step.end","runId":"...","step":"render","durationMs":17}
{"kind":"end","runId":"...","status":"succeeded","exitCode":0,"signal":null}
```

The terminal `end` event is daemon-emitted (not from the engine) once
the subprocess closes.

## Engine spawning

The bridge invokes the engine via `pnpm exec tsx src/cli.ts run <workflow> ...`
from `<OD_AGENTCY_ROOT>/src/studio/runtime/`. `OD_AGENTCY_ROOT` defaults
to `<workspace>/apps/engine`. A packaged-binary path becomes
configurable in Phase E2 alongside durable run state.

Arguments are flattened from `params` via `paramsToCliArgs`:

- `boolean true` → bare flag (`--auto-approve`)
- `boolean false` → omitted
- `null`/`undefined` → omitted
- `Array` → `--<key> <JSON-encoded array>`
- everything else → `--<key> <String(value)>`

## Phase E first cut vs Phase E2

**Now (Phase E first cut):**
- workflow endpoint, SSE stream, artifact serve, path-traversal guards
- in-memory run state (lost on daemon restart)
- additive — no upstream open-design files touched except the
  `registerAgentcyRoutes(app, ...)` call inside `server.ts`

**Deferred to Phase E2:**
- `runs` + `run_events` tables in `.od/app.sqlite` so runs survive a daemon restart and SSE clients can replay from the durable event log
- Web-side `<img src="/api/agentcy/artifacts/...">` integration into the
  artifact viewer
- Workflow-shaped UI (`/runs/new?kind=ad`) and the engine→daemon
  reattach path
- Subprocess detachment so engine work survives daemon restart

## Tests

`apps/daemon/tests/agentcy/`:

- `static.test.ts` — every path-traversal vector (parent dir, absolute
  path, runId with separator, null byte, symlink escape, missing file)
- `spawn.test.ts` — `paramsToCliArgs` flattening
- `routes.test.ts` — HTTP-level validation (400 on bad request, 404 on
  missing/escaping artifact, 200 on planted PNG)

Engine smokes (covered in Phase A docs) verify the JSONL contract this
bridge consumes.
