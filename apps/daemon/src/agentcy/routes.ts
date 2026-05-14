// Express routes for the agentcy bridge.
//
// Run state persists to the daemon's SQLite database via persistence.ts.
// Live SSE clients are tracked in-memory (they can't survive a daemon
// restart anyway); when a daemon comes back up:
//   - any `running` row whose pid is no longer alive is reaped to
//     `failed` by recoverOrphanedRuns()
//   - any `running` row whose pid IS alive + has a recorded log_path
//     gets reattached: the daemon tails the JSONL log file and resumes
//     forwarding events.
//   - clients reconnecting to a still-active run can replay the event
//     log via the `Last-Event-ID` SSE header.
//
// Phase E3.1: detached subprocess + log-file tailer for live forwarding
// + reattach across daemon restarts.

import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import {
  validateAdRequestV1,
  validateEmailRequestV1,
  validatePopupRequestV1,
  ProtocolValidationError,
} from '@mh/protocols'

import { spawnAgentcy } from './spawn.js'
import { tailRunLog, type RunningTailer } from './reattach.js'
import { contentTypeFor, resolveArtifactPath, UnsafeArtifactPath } from './static.js'
import {
  appendEvent,
  appendEventDedupedByLineIndex,
  finishRun,
  getRun,
  insertRun,
  listActiveRuns,
  listRuns,
  migrateAgentcy,
  recoverOrphanedRuns,
  replayEvents,
  setRunLogPath,
  setRunPid,
  type SqliteDb,
} from './persistence.js'
import {
  MH2_AGENTCY_WORKFLOWS,
  NATIVE_AGENTCY_WORKFLOWS,
  type AgentcyEngineLocation,
  type AgentcyRunStatus,
  type AgentcyRuntimeEvent,
  type EngineWorkflow,
  type WorkflowRunRequest,
} from './types.js'

const ALL_WORKFLOWS: ReadonlySet<EngineWorkflow> = new Set([
  ...NATIVE_AGENTCY_WORKFLOWS,
  ...MH2_AGENTCY_WORKFLOWS,
])

const ALL_STATUSES: readonly AgentcyRunStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
] as const

export interface RegisterAgentcyRoutesOptions {
  engine: AgentcyEngineLocation
  db: SqliteDb
  /** Override for tests; defaults to randomUUID. */
  runIdGenerator?: () => string
  /** Override pid-liveness check for tests. */
  isAlive?: (pid: number | null) => boolean
}

interface LiveSubscriber {
  res: Response
  lastSentSeq: number
}

function defaultIsAlive(pid: number | null): boolean {
  if (pid === null || pid === undefined || Number.isNaN(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function registerAgentcyRoutes(app: Express, opts: RegisterAgentcyRoutesOptions): void {
  migrateAgentcy(opts.db)
  const isAlive = opts.isAlive ?? defaultIsAlive
  recoverOrphanedRuns(opts.db, isAlive)

  // In-memory subscriber map; live SSE only, not a source of truth.
  const subscribers = new Map<string, Set<LiveSubscriber>>()
  // In-memory tailer registry — one per active run. Used to surface
  // tailer.done so the reattach test (and shutdown paths) can await it.
  const tailers = new Map<string, RunningTailer>()
  const newRunId = opts.runIdGenerator ?? randomUUID

  function validateRequest(req: WorkflowRunRequest): void {
    // mh2 workflows have closed v1 schemas. Native agentcy workflows
    // (social.post, blog.post, outreach.touch, respond.reply) don't
    // yet have schemas — pass them through unvalidated; the engine's
    // CLI parser is permissive about --key value pairs.
    if (!MH2_AGENTCY_WORKFLOWS.has(req.workflow)) return
    const payload = { brand_id: req.brand_id, ...req.params }
    if (req.workflow === 'ad.post') validateAdRequestV1(payload)
    else if (req.workflow === 'email.design') validateEmailRequestV1(payload)
    else if (req.workflow === 'popup.design') validatePopupRequestV1(payload)
  }

  function fanOut(runId: string, payload: { seq?: number; kind: string; [k: string]: unknown }): void {
    const set = subscribers.get(runId)
    if (!set || set.size === 0) return
    const serialized = JSON.stringify(payload)
    for (const sub of set) {
      const seqPrefix = typeof payload.seq === 'number' ? `id: ${payload.seq}\n` : ''
      sub.res.write(`${seqPrefix}event: ${payload.kind}\ndata: ${serialized}\n\n`)
      if (typeof payload.seq === 'number') sub.lastSentSeq = payload.seq
    }
  }

  function broadcastEnd(
    runId: string,
    status: 'succeeded' | 'failed' | 'canceled',
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    // The terminal `end` event is daemon-emitted and stored in the
    // event log so replay-after-terminal still ends gracefully.
    const event = {
      kind: 'end' as const,
      runId,
      status,
      exitCode,
      signal,
    } as unknown as AgentcyRuntimeEvent
    const { seq } = appendEvent(opts.db, runId, event)
    fanOut(runId, { ...event, seq })
    const set = subscribers.get(runId)
    if (set) {
      for (const sub of set) sub.res.end()
      subscribers.delete(runId)
    }
  }

  /**
   * Start a tailer against a run's JSONL log file. New lines flow into
   * the event log (dedup-keyed on line_index) and out to live SSE
   * subscribers. Returns the tailer so callers can await it before
   * finishing the run.
   */
  function startTailer(args: {
    runId: string
    logPath: string
    isDone: () => boolean
  }): RunningTailer {
    const tailer = tailRunLog({
      logPath: args.logPath,
      isDone: args.isDone,
      onEvent: (lineIndex, event) => {
        const { seq, inserted } = appendEventDedupedByLineIndex(
          opts.db,
          args.runId,
          lineIndex,
          event,
        )
        if (inserted) fanOut(args.runId, { ...event, seq })
      },
    })
    tailers.set(args.runId, tailer)
    void tailer.done.finally(() => {
      if (tailers.get(args.runId) === tailer) tailers.delete(args.runId)
    })
    return tailer
  }

  // Reattach any `running` rows whose pid IS alive (orphans were
  // already swept). Each gets its own tailer rooted on the recorded
  // log_path; when the pid eventually dies, the tailer drains and we
  // finish the run with `failed` (we don't have an exit code from a
  // subprocess we didn't spawn this lifetime).
  for (const row of listActiveRuns(opts.db)) {
    if (!row.logPath || !isAlive(row.pid)) continue
    const recordedPid = row.pid
    const tailer = startTailer({
      runId: row.runId,
      logPath: row.logPath,
      isDone: () => !isAlive(recordedPid),
    })
    void tailer.done.then(() => {
      // Pid died, tail drained. We don't know the exit code from a
      // process we didn't spawn — record what we have.
      const fresh = getRun(opts.db, row.runId)
      if (!fresh || fresh.status !== 'running') return
      finishRun(opts.db, {
        runId: row.runId,
        status: 'failed',
        exitCode: null,
        signal: null,
        endedAt: Date.now(),
        errorMessage: 'reattached_engine_exited',
      })
      broadcastEnd(row.runId, 'failed', null, null)
    })
  }

  // POST /api/agentcy/runs/workflow — start a new workflow run.
  app.post('/api/agentcy/runs/workflow', async (req: Request, res: Response) => {
    const body = req.body as Partial<WorkflowRunRequest> | undefined
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'body must be a WorkflowRunRequest object' })
      return
    }
    if (typeof body.workflow !== 'string' || !ALL_WORKFLOWS.has(body.workflow as EngineWorkflow)) {
      res.status(400).json({ error: 'invalid workflow' })
      return
    }
    if (typeof body.brand_id !== 'string' || body.brand_id.length === 0) {
      res.status(400).json({ error: 'brand_id must be a non-empty string' })
      return
    }
    const params = (body.params ?? {}) as Record<string, unknown>
    const request: WorkflowRunRequest = {
      workflow: body.workflow,
      brand_id: body.brand_id,
      params,
    }

    try {
      validateRequest(request)
    } catch (err) {
      if (err instanceof ProtocolValidationError) {
        res.status(400).json({ error: err.message })
        return
      }
      throw err
    }

    const runId = newRunId()
    const startedAt = Date.now()
    insertRun(opts.db, {
      runId,
      workflow: request.workflow,
      brandId: request.brand_id,
      startedAt,
    })

    const { child, logPath, done } = spawnAgentcy({
      runId,
      workflow: request.workflow,
      brandId: request.brand_id,
      params: request.params,
      engine: opts.engine,
      onStderr: (text) => {
        // stderr bypasses the log file + dedup index — it's a daemon-
        // local annotation, not part of the canonical engine event
        // stream. Use appendEvent (no line_index) so a daemon restart
        // doesn't double-emit.
        const trimmed = text.trim()
        if (!trimmed) return
        const event = {
          kind: 'log',
          runId,
          level: 'error',
          message: trimmed,
        } as unknown as AgentcyRuntimeEvent
        const { seq } = appendEvent(opts.db, runId, event)
        fanOut(runId, { ...event, seq })
      },
    })
    setRunPid(opts.db, runId, child.pid ?? null)
    setRunLogPath(opts.db, runId, logPath)

    let exited = false
    const tailer = startTailer({
      runId,
      logPath,
      isDone: () => exited,
    })

    done.then(async ({ exitCode, signal }) => {
      exited = true
      await tailer.done
      const status = exitCode === 0 ? 'succeeded' : 'failed'
      finishRun(opts.db, {
        runId,
        status,
        exitCode,
        signal,
        endedAt: Date.now(),
      })
      broadcastEnd(runId, status, exitCode, signal)
    })

    res.status(202).json({ runId, workflow: request.workflow, brandId: request.brand_id })
  })

  // GET /api/agentcy/runs — list runs for the dashboard.
  //   ?status=running,failed   one or more statuses (comma-separated)
  //   ?workflow=ad.post        restrict to one workflow
  //   ?brand=givecare          restrict to one brand
  //   ?limit=50                cap row count (1..500, default 50)
  // Newest first by started_at.
  app.get('/api/agentcy/runs', (req: Request, res: Response) => {
    const q = req.query as Record<string, string | string[] | undefined>
    const statusParam = typeof q.status === 'string' ? q.status : undefined
    let statuses: AgentcyRunStatus[] | undefined
    if (statusParam) {
      const parsed = statusParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const bad = parsed.find((s) => !ALL_STATUSES.includes(s as AgentcyRunStatus))
      if (bad) {
        res.status(400).json({ error: `invalid status: ${bad}` })
        return
      }
      statuses = parsed as AgentcyRunStatus[]
    }
    const workflow = typeof q.workflow === 'string' ? q.workflow : undefined
    const brandId = typeof q.brand === 'string' ? q.brand : undefined
    let limit: number | undefined
    if (typeof q.limit === 'string') {
      const n = Number(q.limit)
      if (!Number.isFinite(n) || n <= 0) {
        res.status(400).json({ error: 'limit must be a positive integer' })
        return
      }
      limit = Math.floor(n)
    }
    const filter: import('./persistence.js').ListRunsFilter = {}
    if (statuses) filter.statuses = statuses
    if (workflow) filter.workflow = workflow
    if (brandId) filter.brandId = brandId
    if (limit) filter.limit = limit
    const rows = listRuns(opts.db, filter)
    res.json({
      runs: rows.map((row) => ({
        runId: row.runId,
        workflow: row.workflow,
        brandId: row.brandId,
        status: row.status,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        exitCode: row.exitCode,
        errorMessage: row.errorMessage,
      })),
    })
  })

  // GET /api/agentcy/runs/:runId — status snapshot.
  app.get('/api/agentcy/runs/:runId', (req: Request, res: Response) => {
    const runId = (req.params as Record<string, string | undefined>).runId
    if (!runId) {
      res.status(400).json({ error: 'missing runId' })
      return
    }
    const run = getRun(opts.db, runId)
    if (!run) {
      res.status(404).json({ error: 'run not found' })
      return
    }
    res.json({
      runId: run.runId,
      workflow: run.workflow,
      brandId: run.brandId,
      status: run.status,
      exitCode: run.exitCode,
      signal: run.signal,
      pid: run.pid,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      errorMessage: run.errorMessage,
    })
  })

  // GET /api/agentcy/runs/:runId/events — SSE stream with replay.
  app.get('/api/agentcy/runs/:runId/events', (req: Request, res: Response) => {
    const runId = (req.params as Record<string, string | undefined>).runId
    if (!runId) {
      res.status(400).json({ error: 'missing runId' })
      return
    }
    const run = getRun(opts.db, runId)
    if (!run) {
      res.status(404).json({ error: 'run not found' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    // Last-Event-ID supports SSE reconnect — the client sends the seq
    // of the last event it saw; we replay every event after that.
    const lastEventHeader = req.get('Last-Event-ID') ?? (req.query.after as string | undefined)
    const lastSeq = lastEventHeader ? Number(lastEventHeader) : 0
    const afterSeq = Number.isFinite(lastSeq) && lastSeq > 0 ? lastSeq : 0

    const replay = replayEvents(opts.db, runId, afterSeq)
    let maxSeqSent = afterSeq
    for (const r of replay) {
      const payload = JSON.stringify({ ...r.payload, seq: r.seq })
      res.write(`id: ${r.seq}\nevent: ${r.kind}\ndata: ${payload}\n\n`)
      maxSeqSent = r.seq
    }

    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
      res.end()
      return
    }

    // Active run — subscribe for live events.
    const sub: LiveSubscriber = { res, lastSentSeq: maxSeqSent }
    let set = subscribers.get(runId)
    if (!set) {
      set = new Set<LiveSubscriber>()
      subscribers.set(runId, set)
    }
    set.add(sub)
    req.on('close', () => {
      set?.delete(sub)
      if (set?.size === 0) subscribers.delete(runId)
    })
  })

  // GET /api/agentcy/artifacts/:runId/* — serve engine artifact files.
  app.get('/api/agentcy/artifacts/:runId/*', (req: Request, res: Response) => {
    const params = req.params as Record<string, string | undefined>
    const runId = params.runId
    if (!runId) {
      res.status(400).json({ error: 'missing runId' })
      return
    }
    const wildcardParam = params['0']
    const relpath = typeof wildcardParam === 'string' ? wildcardParam : ''
    try {
      const resolved = resolveArtifactPath(opts.engine.artifactsDir, runId, relpath)
      res.setHeader('Content-Type', contentTypeFor(relpath))
      res.setHeader('Content-Length', String(resolved.size))
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:;")
      createReadStream(resolved.realPath).pipe(res)
    } catch (err) {
      if (err instanceof UnsafeArtifactPath) {
        res.status(404).json({ error: 'not found' })
        return
      }
      throw err
    }
  })
}
