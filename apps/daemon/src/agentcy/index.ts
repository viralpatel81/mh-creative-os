// apps/daemon/src/agentcy/ — agentcy engine bridge.
//
// open-design's existing chat-shaped run lifecycle (apps/daemon/src/runs.ts +
// apps/daemon/src/chat-routes.ts) stays untouched. This module adds a parallel,
// workflow-shaped surface for spawning the agentcy engine and streaming its
// JSONL events (see apps/engine/src/studio/runtime/src/runtime/events.ts) back
// to consumers as SSE.
//
// Exposed routes (registered in server.ts via registerAgentcyRoutes):
//
//   POST /api/agentcy/runs/workflow
//     Body: WorkflowRunRequest { workflow, brand_id, params }
//     Returns: { runId }
//     Side effect: spawns `agentcy studio run <workflow>` with --stream-events
//
//   GET  /api/agentcy/runs/:runId/events
//     SSE stream of { kind, ...RuntimeEvent } JSON envelopes plus a final
//     terminal `end` event when the subprocess exits.
//
//   GET  /api/agentcy/runs/:runId
//     One-shot status: { runId, workflow, brandId, status, exitCode }
//
//   GET  /api/agentcy/artifacts/:runId/:relpath(*)
//     Serves a file under apps/engine/state/artifacts/<runId>/ with strict
//     path-traversal guards. Used by image artifacts emitted by ad.post /
//     email.design / popup.design workflows.

export { registerAgentcyRoutes } from './routes.js'
export type { WorkflowRunRequest, AgentcyRunStatus, AgentcyEngineLocation } from './types.js'
