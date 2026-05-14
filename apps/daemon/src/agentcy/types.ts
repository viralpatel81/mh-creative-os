// Local types for the agentcy bridge. Mirrors of the engine's
// RuntimeEvent union plus the daemon-side WorkflowRunRequest contract.
// Validation against the JSON Schemas lives in routes.ts (using
// @mh/protocols); these are TS-only convenience types.

/**
 * All workflow names the engine knows. Two groups:
 *  - "native" agentcy workflows (social.post, blog.post,
 *    outreach.touch, respond.reply) — predate the mh2 import and
 *    don't yet have v1 request schemas. The daemon accepts them but
 *    passes params straight through.
 *  - mh2-imported workflows (ad.post, email.design, popup.design) —
 *    have closed JSON schemas; the daemon validates payloads before
 *    spawning.
 *
 * Keep the union in sync with apps/engine/src/studio/runtime/src/
 * domain/types.ts WORKFLOW_NAMES.
 */
export type EngineWorkflow =
  | 'social.post'
  | 'blog.post'
  | 'outreach.touch'
  | 'respond.reply'
  | 'ad.post'
  | 'email.design'
  | 'popup.design'

export const NATIVE_AGENTCY_WORKFLOWS: ReadonlySet<EngineWorkflow> = new Set([
  'social.post',
  'blog.post',
  'outreach.touch',
  'respond.reply',
])

export const MH2_AGENTCY_WORKFLOWS: ReadonlySet<EngineWorkflow> = new Set([
  'ad.post',
  'email.design',
  'popup.design',
])

export interface WorkflowRunRequest {
  /** Any engine workflow name. */
  workflow: EngineWorkflow
  brand_id: string
  /**
   * Workflow-specific parameters. For mh2 workflows the params are
   * validated against packages/protocols/schemas/{ad,email,popup}
   * _request.v1.json before the engine is spawned. Native agentcy
   * workflows accept arbitrary params (the engine's CLI takes any
   * --key value pair).
   */
  params: Record<string, unknown>
}

export type AgentcyRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export interface AgentcyEngineLocation {
  /** Absolute path to apps/engine (where pyproject.toml lives). */
  engineRoot: string
  /** Absolute path to apps/engine/state/artifacts — read-only for the daemon. */
  artifactsDir: string
  /** Spawn command + base args; resolved once at registration time. */
  cliCommand: string
  cliBaseArgs: string[]
}

export interface AgentcyRuntimeEvent {
  /** Mirrors the engine's RuntimeEvent.kind values. */
  kind:
    | 'step.start'
    | 'step.end'
    | 'artifact.written'
    | 'log'
    | 'run.failed'
  runId: string
  // Other fields vary by kind; passed through as-is.
  [key: string]: unknown
}
