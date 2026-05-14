// Express routes for the agentcy bridge.
//
// Run state persists to the daemon's SQLite database via persistence.ts.
// Live SSE clients are tracked in-memory (they can't survive a daemon
// restart anyway); when a daemon comes back up:
//   - any `running` row whose pid is no longer alive is reaped to
//     `failed` by recoverOrphanedRuns()
//   - clients reconnecting to a still-active run can replay the event
//     log via the `Last-Event-ID` SSE header
//
// Phase E2 done here: durable run + event log + recovery sweep + replay.
// Phase E3 (deferred): detached subprocesses so the engine keeps
// generating across daemon restarts.

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
import { contentTypeFor, resolveArtifactPath, UnsafeArtifactPath } from './static.js'
import {
  appendEvent,
  finishRun,
  getRun,
  insertRun,
  migrateAgentcy,
  recoverOrphanedRuns,
  replayEvents,
  setRunPid,
  type SqliteDb,
} from './persistence.js'
import type {
  AgentcyEngineLocation,
  AgentcyRuntimeEvent,
  WorkflowRunRequest,
} from './types.js'

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

export function registerAgentcyRoutes(app: Express, opts: RegisterAgentcyRoutesOptions): void {
  migrateAgentcy(opts.db)
  recoverOrphanedRuns(opts.db, opts.isAlive)

  // In-memory subscriber map; live SSE only, not a source of truth.
  const subscribers = new Map<string, Set<LiveSubscriber>>()
  const newRunId = opts.runIdGenerator ?? randomUUID

  function validateRequest(req: WorkflowRunRequest): void {
    const payload = { brand_id: req.brand_id, ...req.params }
    if (req.workflow === 'ad.post') validateAdRequestV1(payload)
    else if (req.workflow === 'email.design') validateEmailRequestV1(payload)
    else if (req.workflow === 'popup.design') validatePopupRequestV1(payload)
    else throw new ProtocolValidationError(`unknown workflow: ${req.workflow}`, '')
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

  function recordAndBroadcast(runId: string, event: AgentcyRuntimeEvent): void {
    const { seq } = appendEvent(opts.db, runId, event)
    fanOut(runId, { ...event, seq })
  }

  function broadcastEnd(
    runId: string,
    status: 'succeeded' | 'failed' | 'canceled',
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    // The terminal `end` event is daemon-emitted and stored in the
    // event log so replay-after-terminal still ends gracefully.
    recordAndBroadcast(runId, {
      kind: 'end' as const,
      runId,
      status,
      exitCode,
      signal,
    } as unknown as AgentcyRuntimeEvent)
    const set = subscribers.get(runId)
    if (set) {
      for (const sub of set) sub.res.end()
      subscribers.delete(runId)
    }
  }

  // POST /api/agentcy/runs/workflow — start a new workflow run.
  app.post('/api/agentcy/runs/workflow', async (req: Request, res: Response) => {
    const body = req.body as Partial<WorkflowRunRequest> | undefined
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'body must be a WorkflowRunRequest object' })
      return
    }
    if (
      body.workflow !== 'ad.post' &&
      body.workflow !== 'email.design' &&
      body.workflow !== 'popup.design'
    ) {
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

    const { child, done } = spawnAgentcy({
      workflow: request.workflow,
      brandId: request.brand_id,
      params: request.params,
      engine: opts.engine,
      onEvent: (event) => recordAndBroadcast(runId, event),
      onStderr: (text) => {
        recordAndBroadcast(runId, {
          kind: 'log',
          runId,
          level: 'error',
          message: text.trim(),
        })
      },
    })
    setRunPid(opts.db, runId, child.pid ?? null)

    done.then(({ exitCode, signal }) => {
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
