// Local types for the agentcy bridge. Mirrors of the engine's
// RuntimeEvent union plus the daemon-side WorkflowRunRequest contract.
// Validation against the JSON Schemas lives in routes.ts (using
// @mh/protocols); these are TS-only convenience types.

export interface WorkflowRunRequest {
  /** One of the engine workflow names: ad.post | email.design | popup.design. */
  workflow: 'ad.post' | 'email.design' | 'popup.design'
  brand_id: string
  /**
   * Workflow-specific parameters. Validated against
   * packages/protocols/schemas/{ad,email,popup}_request.v1.json before
   * the engine is spawned.
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
