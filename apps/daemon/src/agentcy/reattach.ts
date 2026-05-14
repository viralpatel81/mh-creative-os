// Per-run JSONL log tailer used by both the live workflow path and the
// daemon-restart reattach path. The engine writes its RuntimeEvent JSONL
// directly to <engine-root>/state/run-logs/<runId>.jsonl via the
// detached stdout fd (see spawn.ts). The daemon never reads engine
// stdout through a pipe; instead it polls the file for newly-appended
// bytes and forwards them.
//
// Design choices:
//
//   - Polling (not fs.watch). fs.watch is unreliable for append events
//     across platforms; a 50 ms poll cadence is plenty fast for our
//     workflow timescales (single-image renders take seconds) and
//     deterministic for tests.
//
//   - Line index, not byte offset. The dedup column on agentcy_run_events
//     is line_index — robust against torn-line writes and partial-line
//     replays (we hold the trailing partial line until more bytes
//     arrive). Two daemon lifetimes tailing the same file land on the
//     same line_index for line N.
//
//   - Stop conditions. Live tail stops when (a) the subprocess we
//     spawned exits AND we've drained EOF, or (b) the caller calls
//     stop(). Reattach tail stops when the recorded pid is no longer
//     alive AND we've drained EOF.
//
// The tailer is responsible only for parsing + emitting; persistence,
// fan-out to SSE subscribers, and finishRun() live in routes.ts.

import { promises as fs } from 'node:fs'

import type { AgentcyRuntimeEvent } from './types.js'

export interface TailRunLogOptions {
  /** Absolute path to the JSONL log file written by the engine. */
  logPath: string
  /** Invoked once per new line (line index is 1-based, matching DB line_index). */
  onEvent: (lineIndex: number, event: AgentcyRuntimeEvent) => void
  /**
   * Predicate the tailer polls between read cycles. When this returns
   * true the tailer drains EOF and resolves done. Used to detect "child
   * exited" (live) or "remembered pid is dead" (reattach).
   */
  isDone: () => boolean
  /** Poll cadence in ms. Defaults to 50ms. */
  pollIntervalMs?: number
  /** Called whenever a malformed line is encountered. Best-effort logging. */
  onMalformed?: (line: string) => void
}

export interface RunningTailer {
  /** Resolves once isDone() is true AND the file has been fully drained. */
  done: Promise<void>
  /** Force the tailer to stop on the next poll cycle. */
  stop(): void
}

/**
 * Start a tailer against a JSONL log file. Resolves once isDone() is
 * true and EOF has been drained. Safe to call before the file exists —
 * the tailer will wait for it to appear.
 */
export function tailRunLog(opts: TailRunLogOptions): RunningTailer {
  const pollIntervalMs = opts.pollIntervalMs ?? 50
  let stopped = false
  let cursor = 0 // bytes consumed
  let lineIndex = 0 // 1-based
  let partial = '' // trailing chunk that didn't end with \n

  async function tick(): Promise<boolean> {
    let handle: fs.FileHandle | null = null
    try {
      handle = await fs.open(opts.logPath, 'r')
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return false
      throw err
    }
    try {
      const stat = await handle.stat()
      if (stat.size === cursor) return false
      if (stat.size < cursor) {
        // File truncated — reset and re-read. This shouldn't happen in
        // practice (engine never truncates) but defending against it
        // keeps the tailer total.
        cursor = 0
        lineIndex = 0
        partial = ''
      }
      const length = stat.size - cursor
      const buf = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buf, 0, length, cursor)
      cursor += bytesRead
      const chunk = partial + buf.subarray(0, bytesRead).toString('utf8')
      const lines = chunk.split('\n')
      partial = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) {
          lineIndex += 1
          continue
        }
        lineIndex += 1
        try {
          const parsed = JSON.parse(line) as AgentcyRuntimeEvent
          if (parsed && typeof parsed.kind === 'string') opts.onEvent(lineIndex, parsed)
          else opts.onMalformed?.(line)
        } catch {
          opts.onMalformed?.(line)
        }
      }
      return true
    } finally {
      await handle.close()
    }
  }

  const done = (async () => {
    // Loop: poll until stopped OR (isDone AND no new bytes this cycle).
    while (!stopped) {
      const advanced = await tick()
      if (stopped) break
      if (opts.isDone() && !advanced) {
        // One last drain to be safe — isDone() may have flipped between
        // the read and the predicate check.
        await tick()
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs))
    }
    // Drain any unread tail on forced stop.
    await tick()
  })()

  return {
    done,
    stop: () => {
      stopped = true
    },
  }
}
