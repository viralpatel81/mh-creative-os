// Spawn the agentcy engine for a single workflow run. The engine's
// JSONL stdout is wired directly to a per-run log file on disk so the
// engine subprocess can survive a daemon restart (E3.1) — there is no
// pipe to break. The daemon reads events from that file via a tailer
// (reattach.ts), which serves both the live forwarding path and the
// reattach-after-restart path.
//
// Design notes:
//  - The engine is invoked via `pnpm exec tsx src/cli.ts run <workflow> ... --stream-events`
//    from inside apps/engine/src/studio/runtime/. We don't shell out to an
//    `agentcy` binary that may or may not be on PATH; pinning the runtime
//    invocation keeps the daemon hermetic.
//  - stdin is closed: agentcy's `studio run` is fully non-interactive.
//  - stdout is connected to a file descriptor for
//    `<engineRoot>/state/run-logs/<runId>.jsonl`. The daemon never reads
//    this stream directly; the tailer polls the file.
//  - stderr is captured and surfaced via onStderr().
//  - The subprocess is detached + unrefed so the daemon can exit
//    without killing the engine. The recovery sweep + tailer rejoin
//    on restart.

import { spawn, type ChildProcess } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import type { AgentcyEngineLocation, EngineWorkflow } from './types.js'

export interface SpawnAgentcyInput {
  runId: string
  workflow: EngineWorkflow
  brandId: string
  params: Record<string, unknown>
  engine: AgentcyEngineLocation
  /** Called for stderr (each chunk; not line-buffered). */
  onStderr?: (text: string) => void
}

export interface AgentcyChild {
  child: ChildProcess
  /** Absolute path to the per-run JSONL log file the engine writes. */
  logPath: string
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

/**
 * Build the per-run JSONL log path the engine writes to. Exposed for
 * the routes module so reattach can stat the same path.
 */
export function runLogPath(engineRoot: string, runId: string): string {
  return join(engineRoot, 'state', 'run-logs', `${runId}.jsonl`)
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

  const logPath = runLogPath(input.engine.engineRoot, input.runId)
  mkdirSync(dirname(logPath), { recursive: true })
  // 'a' so a reattach would append rather than truncate. Each spawn is
  // a fresh runId so collisions only happen if the same id was somehow
  // started twice; even then we preserve prior bytes for forensic value.
  const logFd = openSync(logPath, 'a')

  let child: ChildProcess
  try {
    child = spawn(input.engine.cliCommand, args, {
      cwd: input.engine.engineRoot + '/src/studio/runtime',
      env: process.env,
      // detached + unref(): daemon exit doesn't kill the engine. The
      // child becomes its own process group leader.
      detached: true,
      stdio: ['ignore', logFd, 'pipe'],
    })
  } finally {
    // We dup'd the fd into the child via stdio; the parent's copy can
    // be closed regardless of spawn success. If spawn threw, we still
    // free the fd to avoid leaking.
    closeSync(logFd)
  }
  child.unref()

  if (input.onStderr && child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => input.onStderr!(chunk.toString('utf8')))
  }

  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => {
      resolve({ exitCode: code, signal })
    })
  })

  return { child, logPath, done }
}
