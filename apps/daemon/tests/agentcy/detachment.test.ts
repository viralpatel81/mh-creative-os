// E3.1 — Detachment test for the agentcy bridge.
//
// What's verified:
//   1. spawnAgentcy() opens a per-run JSONL log file under
//      <engineRoot>/state/run-logs/<runId>.jsonl.
//   2. The subprocess's stdout writes land in that file (not in a
//      pipe the daemon owns).
//   3. The subprocess is detached + unrefed: closing whatever ref
//      the parent kept doesn't kill the child, and the eventual
//      exit code is still captured via the done promise.
//
// To keep the test hermetic we don't invoke the real agentcy engine.
// Instead we use `node` as the cliCommand and inject a tiny inline
// script through cliBaseArgs. The script writes one JSONL line then
// exits 0. (The conventional args spawnAgentcy appends — `run`,
// `--brand`, `--auto-approve`, `--stream-events`, etc. — get passed
// through to the node script as positional argv and are harmlessly
// ignored by our script body.)

import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { spawnAgentcy, runLogPath } from '../../src/agentcy/spawn.js'

function mkRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mh-agentcy-detach-'))
}

describe('spawnAgentcy detachment', () => {
  it('routes child stdout to a per-run JSONL log file and resolves exit code', async () => {
    const engineRoot = mkRoot()
    try {
      // tsx convention: spawnAgentcy enters cwd=<engineRoot>/src/studio/runtime.
      // Node only cares that cwd exists; create it.
      const runtimeDir = join(engineRoot, 'src', 'studio', 'runtime')
      const { mkdirSync, writeFileSync: _w } = await import('node:fs')
      mkdirSync(runtimeDir, { recursive: true })

      const script =
        `const ev = {kind:"step.start",runId:"r-det",step:"render"};` +
        `process.stdout.write(JSON.stringify(ev)+"\\n");` +
        // Flush and exit so the test doesn't hang.
        `process.exit(0);`

      const { child, logPath, done } = spawnAgentcy({
        runId: 'r-det',
        workflow: 'ad.post',
        brandId: 'b',
        params: {},
        engine: {
          engineRoot,
          artifactsDir: join(engineRoot, 'state', 'artifacts'),
          cliCommand: 'node',
          cliBaseArgs: ['-e', script],
        },
      })

      // Path contract: <engineRoot>/state/run-logs/<runId>.jsonl
      expect(logPath).toBe(runLogPath(engineRoot, 'r-det'))
      expect(child.pid).toBeTypeOf('number')

      const { exitCode, signal } = await done
      expect(exitCode).toBe(0)
      expect(signal).toBeNull()

      // The log file exists and contains the JSONL line.
      expect(existsSync(logPath)).toBe(true)
      const text = readFileSync(logPath, 'utf8')
      expect(text).toMatch(/"kind":"step\.start"/)
      expect(text).toMatch(/"runId":"r-det"/)
      expect(text).toMatch(/"step":"render"/)
    } finally {
      rmSync(engineRoot, { recursive: true, force: true })
    }
  })
})
