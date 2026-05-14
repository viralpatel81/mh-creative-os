// RunDetail (Phase E3.3.e).
//
// Subscribes to GET /api/agentcy/runs/:runId/events (SSE) and renders:
//   - status banner (runId, workflow, brand, status badge)
//   - artifact cards for image artifacts (uses resolveImageSrc from
//     the E3.2 image renderer to map engine paths to daemon URLs)
//   - chronological event timeline (step.start, step.end, log,
//     artifact.written, run.failed, end)
//
// SSE is parsed from a fetch ReadableStream. This avoids the
// EventSource API entirely (jsdom doesn't ship one and we'd otherwise
// need a polyfill); we get streaming reconnect semantics and
// Last-Event-ID support out of the daemon for free.
//
// New file — no Apache change-notice needed.

import { useEffect, useMemo, useRef, useState } from 'react';

import { resolveImageSrc } from '../artifacts/image-url';
import { navigate } from '../router';

type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

interface RunSnapshot {
  runId: string;
  workflow: string;
  brandId: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  errorMessage: string | null;
}

interface BaseEvent {
  seq?: number;
  kind: string;
}

interface StepStartEvent extends BaseEvent {
  kind: 'step.start';
  step: string;
}
interface StepEndEvent extends BaseEvent {
  kind: 'step.end';
  step: string;
  durationMs: number;
}
interface LogEvent extends BaseEvent {
  kind: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
}
interface ArtifactWrittenEvent extends BaseEvent {
  kind: 'artifact.written';
  type: string;
  path: string;
  identifier?: string;
  title?: string;
}
interface RunFailedEvent extends BaseEvent {
  kind: 'run.failed';
  step: string;
  error: string;
}
interface EndEvent extends BaseEvent {
  kind: 'end';
  status: RunStatus;
  exitCode: number | null;
}

type AnyEvent =
  | StepStartEvent
  | StepEndEvent
  | LogEvent
  | ArtifactWrittenEvent
  | RunFailedEvent
  | EndEvent
  | (BaseEvent & Record<string, unknown>);

export interface RunDetailProps {
  runId: string;
  /** Test seam — defaults to window.fetch. */
  fetcher?: typeof fetch;
}

export function RunDetail({ runId, fetcher }: RunDetailProps): JSX.Element {
  const fx = fetcher ?? fetch;
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [events, setEvents] = useState<AnyEvent[]>([]);
  // If the terminal `end` event arrives before the snapshot lands
  // (the SSE stream is faster than the snapshot fetch in tests, and
  // can race in production too if the run is short-lived), we stash
  // the terminal status here and prefer it over the snapshot's value.
  const [terminalEnd, setTerminalEnd] = useState<{
    status: RunStatus;
    exitCode: number | null;
  } | null>(null);
  const seenSeqs = useRef<Set<number>>(new Set());

  // Snapshot fetch — gives us the header + initial status before SSE
  // backfill arrives.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fx(`/api/agentcy/runs/${encodeURIComponent(runId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setSnapshotError('Run not found');
          return;
        }
        if (!res.ok) {
          setSnapshotError(`HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as RunSnapshot;
        setSnapshot(body);
      } catch (err) {
        if (!cancelled) setSnapshotError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fx, runId]);

  // SSE subscribe — parses the daemon's text/event-stream and pushes
  // each event into local state. Terminates when the stream closes
  // (daemon ends the response on terminal status) or the component
  // unmounts.
  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fx(`/api/agentcy/runs/${encodeURIComponent(runId)}/events`, {
          signal: ctrl.signal,
          headers: { Accept: 'text/event-stream' },
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE event delimiter is a blank line. We split on '\n\n'
          // and parse each block as one event.
          let split = buffer.indexOf('\n\n');
          while (split !== -1) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const parsed = parseSseBlock(block);
            if (parsed) ingest(parsed);
            split = buffer.indexOf('\n\n');
          }
        }
        // Flush any trailing block (some test harnesses don't end
        // with the SSE delimiter).
        if (buffer.trim().length > 0) {
          const parsed = parseSseBlock(buffer);
          if (parsed) ingest(parsed);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        // Network blip — don't tear down the UI, just log it.
        // eslint-disable-next-line no-console
        console.warn('[RunDetail] SSE stream error:', err);
      }
    })();
    return () => ctrl.abort();

    function ingest(ev: AnyEvent): void {
      if (typeof ev.seq === 'number') {
        if (seenSeqs.current.has(ev.seq)) return;
        seenSeqs.current.add(ev.seq);
      }
      setEvents((prev) => [...prev, ev]);
      if (ev.kind === 'end') {
        const endEv = ev as EndEvent;
        setTerminalEnd({ status: endEv.status, exitCode: endEv.exitCode });
      }
    }
  }, [fx, runId]);

  const effectiveStatus: RunStatus | null = terminalEnd
    ? terminalEnd.status
    : snapshot
      ? snapshot.status
      : null;

  const artifactEvents = useMemo(
    () => events.filter((e): e is ArtifactWrittenEvent => e.kind === 'artifact.written'),
    [events],
  );

  return (
    <div className="run-detail" data-testid="run-detail">
      <header className="run-detail__header">
        <button
          type="button"
          className="run-detail__back"
          onClick={() => navigate({ kind: 'runs' })}
        >
          ← Runs
        </button>
        <h1 className="run-detail__title">
          <code>{runId}</code>
        </h1>
        {effectiveStatus ? <StatusBadge status={effectiveStatus} /> : null}
      </header>

      {snapshotError ? (
        <p
          className="run-detail__status run-detail__status--error"
          data-testid="run-detail-error"
        >
          {snapshotError}
        </p>
      ) : null}

      {snapshot ? (
        <dl className="run-detail__meta">
          <div>
            <dt>Workflow</dt>
            <dd>{snapshot.workflow}</dd>
          </div>
          <div>
            <dt>Brand</dt>
            <dd>{snapshot.brandId}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatStarted(snapshot.startedAt)}</dd>
          </div>
          {snapshot.endedAt !== null ? (
            <div>
              <dt>Ended</dt>
              <dd>{formatStarted(snapshot.endedAt)}</dd>
            </div>
          ) : null}
          {snapshot.errorMessage ? (
            <div>
              <dt>Error</dt>
              <dd>{snapshot.errorMessage}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <section className="run-detail__artifacts" data-testid="run-detail-artifacts">
        <h2>Artifacts ({artifactEvents.length})</h2>
        {artifactEvents.length === 0 ? (
          <p className="run-detail__empty">No artifacts yet.</p>
        ) : (
          <ul className="run-detail__artifact-grid">
            {artifactEvents.map((ev, i) => (
              <ArtifactCard
                key={ev.identifier || `${ev.path}-${i}`}
                event={ev}
                runId={runId}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="run-detail__timeline" data-testid="run-detail-timeline">
        <h2>Timeline ({events.length})</h2>
        {events.length === 0 ? (
          <p className="run-detail__empty">Waiting for events…</p>
        ) : (
          <ol className="run-detail__timeline-list">
            {events.map((ev, i) => (
              <TimelineRow key={ev.seq ?? `e-${i}`} event={ev} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function ArtifactCard({
  event,
  runId,
}: {
  event: ArtifactWrittenEvent;
  runId: string;
}): JSX.Element {
  const isImage = event.type.startsWith('image/') && !event.type.includes('svg');
  const url = isImage ? resolveImageSrc(event.path, { runId }) : null;
  return (
    <li
      className="run-detail__artifact-card"
      data-testid={`run-artifact-${event.identifier || event.path}`}
    >
      <div className="run-detail__artifact-meta">
        <strong>{event.title || event.identifier || event.path}</strong>
        <span className="run-detail__artifact-type">{event.type}</span>
      </div>
      {url ? (
        <img
          src={url}
          alt={event.title || event.identifier || ''}
          className="run-detail__artifact-image"
          data-testid={`run-artifact-image-${event.identifier || event.path}`}
        />
      ) : (
        <code className="run-detail__artifact-path">{event.path}</code>
      )}
    </li>
  );
}

function TimelineRow({ event }: { event: AnyEvent }): JSX.Element {
  return (
    <li
      className={`run-detail__timeline-row run-detail__timeline-row--${event.kind.replace('.', '-')}`}
      data-testid={`timeline-row-${event.kind}`}
    >
      <span className="run-detail__timeline-kind">{event.kind}</span>
      <span className="run-detail__timeline-summary">{summarize(event)}</span>
    </li>
  );
}

function summarize(event: AnyEvent): string {
  if (event.kind === 'step.start') return (event as StepStartEvent).step;
  if (event.kind === 'step.end') {
    const e = event as StepEndEvent;
    return `${e.step} (${e.durationMs}ms)`;
  }
  if (event.kind === 'log') {
    const e = event as LogEvent;
    return `[${e.level}] ${e.message}`;
  }
  if (event.kind === 'artifact.written') {
    const e = event as ArtifactWrittenEvent;
    return e.title || e.identifier || e.path;
  }
  if (event.kind === 'run.failed') {
    const e = event as RunFailedEvent;
    return `${e.step}: ${e.error}`;
  }
  if (event.kind === 'end') {
    const e = event as EndEvent;
    return `status=${e.status} exit=${e.exitCode ?? '?'}`;
  }
  return '';
}

function StatusBadge({ status }: { status: RunStatus }): JSX.Element {
  return (
    <span
      className={`run-detail__badge run-detail__badge--${status}`}
      data-testid={`run-detail-status-${status}`}
    >
      {status}
    </span>
  );
}

function formatStarted(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString();
}

/**
 * Parse one SSE event block: a sequence of lines, each "field: value",
 * with optional trailing newline. Returns the parsed JSON payload from
 * the `data:` line (with a `kind` injected from the `event:` line if
 * the data didn't carry one).
 */
function parseSseBlock(block: string): AnyEvent | null {
  let kind: string | undefined;
  let dataLine: string | undefined;
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('event:')) {
      kind = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLine = (dataLine ? `${dataLine}\n` : '') + line.slice('data:'.length).trimStart();
    }
  }
  if (!dataLine) return null;
  try {
    const parsed = JSON.parse(dataLine) as AnyEvent;
    if (!parsed.kind && kind) {
      return { ...parsed, kind } as AnyEvent;
    }
    return parsed;
  } catch {
    return null;
  }
}
