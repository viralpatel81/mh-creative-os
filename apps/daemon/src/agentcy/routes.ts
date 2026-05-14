// Express routes for the agentcy bridge. Self-contained — call
// registerAgentcyRoutes(app, opts) once during daemon startup.
//
// Run state is in-memory for Phase E first cut (durable runs table is
// Phase E2). On daemon restart, runs in flight are abandoned; the
// engine subprocess itself is *not* detached, so it will be torn down
// when the daemon exits.

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
import type {
  AgentcyEngineLocation,
  AgentcyRunStatus,
  AgentcyRuntimeEvent,
  WorkflowRunRequest,
} from './types.js'

interface RunRecord {
  runId: string
  workflow: WorkflowRunRequest['workflow']
  brandId: string
  status: AgentcyRunStatus
  exitCode: number | null
  signal: NodeJS.Signals | null
  startedAt: number
  events: AgentcyRuntimeEvent[]
  /** Open SSE response objects subscribed to this run. */
  subscribers: Set<Response>
}

export interface RegisterAgentcyRoutesOptions {
  engine: AgentcyEngineLocation
  /** Override for tests; defaults to randomUUID. */
  runIdGenerator?: () => string
}

export function registerAgentcyRoutes(app: Express, opts: RegisterAgentcyRoutesOptions): void {
  const runs = new Map<string, RunRecord>()
  const newRunId = opts.runIdGenerator ?? randomUUID

  function validateRequest(req: WorkflowRunRequest): void {
    const payload = { brand_id: req.brand_id, ...req.params }
    if (req.workflow === 'ad.post') validateAdRequestV1(payload)
    else if (req.workflow === 'email.design') validateEmailRequestV1(payload)
    else if (req.workflow === 'popup.design') validatePopupRequestV1(payload)
    else throw new ProtocolValidationError(`unknown workflow: ${req.workflow}`, '')
  }

  function broadcast(run: RunRecord, event: AgentcyRuntimeEvent | { kind: 'end'; [k: string]: unknown }): void {
    const payload = JSON.stringify(event)
    for (const sse of run.subscribers) {
      sse.write(`event: ${event.kind}\ndata: ${payload}\n\n`)
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
    const record: RunRecord = {
      runId,
      workflow: request.workflow,
      brandId: request.brand_id,
      status: 'running',
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      events: [],
      subscribers: new Set(),
    }
    runs.set(runId, record)

    const { done } = spawnAgentcy({
      workflow: request.workflow,
      brandId: request.brand_id,
      params: request.params,
      engine: opts.engine,
      onEvent: (event) => {
        record.events.push(event)
        broadcast(record, event)
      },
      onStderr: (text) => {
        const logEvent: AgentcyRuntimeEvent = {
          kind: 'log',
          runId,
          level: 'error',
          message: text.trim(),
        }
        record.events.push(logEvent)
        broadcast(record, logEvent)
      },
    })

    done.then(({ exitCode, signal }) => {
      record.exitCode = exitCode
      record.signal = signal
      record.status = exitCode === 0 ? 'succeeded' : 'failed'
      broadcast(record, { kind: 'end', runId, status: record.status, exitCode, signal })
      for (const sse of record.subscribers) sse.end()
      record.subscribers.clear()
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
    const run = runs.get(runId)
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
      startedAt: run.startedAt,
      eventCount: run.events.length,
    })
  })

  // GET /api/agentcy/runs/:runId/events — SSE stream of RuntimeEvents.
  app.get('/api/agentcy/runs/:runId/events', (req: Request, res: Response) => {
    const runId = (req.params as Record<string, string | undefined>).runId
    if (!runId) {
      res.status(400).json({ error: 'missing runId' })
      return
    }
    const run = runs.get(runId)
    if (!run) {
      res.status(404).json({ error: 'run not found' })
      return
    }
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    // Replay buffered events for late subscribers (and one-shot clients
    // that connect after a terminal status).
    for (const ev of run.events) {
      res.write(`event: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`)
    }
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
      res.write(
        `event: end\ndata: ${JSON.stringify({
          kind: 'end',
          runId: run.runId,
          status: run.status,
          exitCode: run.exitCode,
          signal: run.signal,
        })}\n\n`,
      )
      res.end()
      return
    }

    run.subscribers.add(res)
    req.on('close', () => {
      run.subscribers.delete(res)
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
      // Strict CSP: rendered images shouldn't navigate or pull from anywhere.
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
