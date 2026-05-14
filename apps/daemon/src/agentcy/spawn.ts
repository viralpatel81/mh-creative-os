// Spawn the agentcy engine for a single workflow run and surface its
// JSONL stdout as parsed RuntimeEvents. The bridge layer in routes.ts
// turns those into SSE for HTTP clients.
//
// Design notes:
//  - The engine is invoked via `pnpm exec tsx src/cli.ts run <workflow> ... --stream-events`
//    from inside apps/engine/src/studio/runtime/. We don't shell out to an
//    `agentcy` binary that may or may not be on PATH; pinning the runtime
//    invocation keeps the daemon hermetic.
//  - stdin is closed: agentcy's `studio run` is fully non-interactive.
//  - stderr is captured and surfaced as a `log { level: 'error' }` event.
//  - The subprocess is *not* detached. The agentcy bridge runs synchronously
//    relative to the daemon for now; durable subprocess survival across
//    daemon restarts is Phase E2 (durable run table + reattach).

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentcyEngineLocation, AgentcyRuntimeEvent } from './types.js'

export interface SpawnAgentcyInput {
  workflow: 'ad.post' | 'email.design' | 'popup.design'
  brandId: string
  params: Record<string, unknown>
  engine: AgentcyEngineLocation
  /** Called for each parsed JSONL event from engine stdout. */
  onEvent: (event: AgentcyRuntimeEvent) => void
  /** Called for stderr (each chunk; not line-buffered). */
  onStderr?: (text: string) => void
}

export interface AgentcyChild {
  child: ChildProcess
  /** Resolves with exit code (or null on signal). */
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
}

/**
 * Translate WorkflowRunRequest.params into the engine CLI flag form. The
 * engine's CLI parser (apps/engine/.../src/commands/run.ts) treats every
 * --<key> <value> pair as an input key. Arrays go as JSON strings — the
 * engine pipelines coerce them back, but for now we only flatten scalars
 * and emit one --key per array entry to match parseWorkflowInput's
 * key-collection behavior.
 */
export function paramsToCliArgs(params: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'boolean') {
      if (value) out.push(`--${key}`)
      continue
    }
    if (Array.isArray(value)) {
      // The engine's CLI parser currently doesn't merge repeated flags
      // into arrays, so we JSON-encode the whole array as a single value
      // and let pipelines that need it parse with JSON.parse. The
      // pipeline modules under apps/engine/.../workflows/ are tolerant
      // of both forms (Array via the daemon JSON path) and fall back to
      // defaults if a stringly value sneaks through.
      out.push(`--${key}`, JSON.stringify(value))
      continue
    }
    out.push(`--${key}`, String(value))
  }
  return out
}

export function spawnAgentcy(input: SpawnAgentcyInput): AgentcyChild {
  const args = [
    ...input.engine.cliBaseArgs,
    'run',
    input.workflow,
    '--brand',
    input.brandId,
    '--auto-approve',
    '--stream-events',
    ...paramsToCliArgs(input.params),
  ]

  const child = spawn(input.engine.cliCommand, args, {
    cwd: input.engine.engineRoot + '/src/studio/runtime',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const stdoutLines = createInterface({ input: child.stdout!, crlfDelay: Infinity })
  stdoutLines.on('line', (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) return // skip the engine's terminal pretty-printed RunRecord
    try {
      const parsed = JSON.parse(trimmed) as AgentcyRuntimeEvent
      if (parsed && typeof parsed.kind === 'string') input.onEvent(parsed)
    } catch {
      // Malformed JSONL line — skip. The engine never emits partial
      // lines; if we see one, it's a bug in stream piping, not a
      // recoverable parse issue here.
    }
  })

  if (input.onStderr) {
    child.stderr!.on('data', (chunk: Buffer) => input.onStderr!(chunk.toString('utf8')))
  }

  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => {
      stdoutLines.close()
      resolve({ exitCode: code, signal })
    })
  })

  return { child, done }
}
