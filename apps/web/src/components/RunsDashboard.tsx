// RunsDashboard (Phase E3.3.d).
//
// Lists recent agentcy runs from GET /api/agentcy/runs. Auto-refreshes
// every 10s while any row is still `running` so the operator sees the
// list go quiet without a manual reload. The detail page (E3.3.e) is
// not yet wired — runId cells render as plain text for now.
//
// New file — no Apache change-notice needed.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { navigate } from '../router';

type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

interface RunRow {
  runId: string;
  workflow: string;
  brandId: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  errorMessage: string | null;
}

interface RunsListResponse {
  runs?: RunRow[];
}

const STATUS_FILTERS: Array<{ id: RunStatus | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'succeeded', label: 'Succeeded' },
  { id: 'failed', label: 'Failed' },
  { id: 'canceled', label: 'Canceled' },
];

const WORKFLOWS = ['ad.post', 'email.design', 'popup.design'] as const;
type Workflow = (typeof WORKFLOWS)[number];

const POLL_INTERVAL_MS = 10_000;

export interface RunsDashboardProps {
  /** Test seam — defaults to window.fetch. */
  fetcher?: typeof fetch;
  /** Test seam — override the poll interval. */
  pollIntervalMs?: number;
}

export function RunsDashboard({ fetcher, pollIntervalMs }: RunsDashboardProps): JSX.Element {
  const fx = fetcher ?? fetch;
  const interval = pollIntervalMs ?? POLL_INTERVAL_MS;
  const [status, setStatus] = useState<RunStatus | 'all'>('all');
  const [workflow, setWorkflow] = useState<Workflow | 'all'>('all');
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (workflow !== 'all') params.set('workflow', workflow);
    return params.toString();
  }, [status, workflow]);

  const load = useCallback(async () => {
    try {
      const url = query
        ? `/api/agentcy/runs?${query}`
        : '/api/agentcy/runs';
      const res = await fx(url);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as RunsListResponse;
      setRuns(Array.isArray(body.runs) ? body.runs : []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [fx, query]);

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const hasRunning = useMemo(
    () => Array.isArray(runs) && runs.some((r) => r.status === 'running' || r.status === 'queued'),
    [runs],
  );

  useEffect(() => {
    if (!hasRunning) return;
    const handle = setInterval(() => {
      void load();
    }, interval);
    return () => clearInterval(handle);
  }, [hasRunning, interval, load]);

  return (
    <div className="runs-dashboard" data-testid="runs-dashboard">
      <header className="runs-dashboard__header">
        <button
          type="button"
          className="runs-dashboard__back"
          onClick={() => navigate({ kind: 'home' })}
        >
          ← Home
        </button>
        <h1 className="runs-dashboard__title">Runs</h1>
        {hasRunning ? (
          <span className="runs-dashboard__polling" data-testid="runs-polling">
            Polling…
          </span>
        ) : null}
      </header>

      <div className="runs-dashboard__filters">
        <fieldset>
          <legend>Status</legend>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={
                status === f.id
                  ? 'runs-dashboard__chip runs-dashboard__chip--active'
                  : 'runs-dashboard__chip'
              }
              data-testid={`runs-filter-status-${f.id}`}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </fieldset>
        <fieldset>
          <legend>Workflow</legend>
          <button
            type="button"
            className={
              workflow === 'all'
                ? 'runs-dashboard__chip runs-dashboard__chip--active'
                : 'runs-dashboard__chip'
            }
            data-testid="runs-filter-workflow-all"
            onClick={() => setWorkflow('all')}
          >
            All
          </button>
          {WORKFLOWS.map((wf) => (
            <button
              key={wf}
              type="button"
              className={
                workflow === wf
                  ? 'runs-dashboard__chip runs-dashboard__chip--active'
                  : 'runs-dashboard__chip'
              }
              data-testid={`runs-filter-workflow-${wf}`}
              onClick={() => setWorkflow(wf)}
            >
              {wf}
            </button>
          ))}
        </fieldset>
      </div>

      {error ? (
        <p className="runs-dashboard__status runs-dashboard__status--error" data-testid="runs-error">
          {error}
        </p>
      ) : null}

      {runs === null ? (
        <p className="runs-dashboard__status">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="runs-dashboard__empty" data-testid="runs-empty">
          No runs match the current filters.
        </p>
      ) : (
        <table className="runs-dashboard__table" data-testid="runs-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Workflow</th>
              <th>Brand</th>
              <th>Status</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((row) => (
              <tr key={row.runId} data-testid={`runs-row-${row.runId}`}>
                <td>
                  <button
                    type="button"
                    className="runs-dashboard__row-link"
                    data-testid={`runs-row-link-${row.runId}`}
                    onClick={() => navigate({ kind: 'run', runId: row.runId })}
                  >
                    <code>{row.runId}</code>
                  </button>
                </td>
                <td>{row.workflow}</td>
                <td>{row.brandId}</td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>{formatStarted(row.startedAt)}</td>
                <td>{formatDuration(row.startedAt, row.endedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }): JSX.Element {
  return (
    <span
      className={`runs-dashboard__badge runs-dashboard__badge--${status}`}
      data-testid={`runs-status-${status}`}
    >
      {status}
    </span>
  );
}

function formatStarted(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const date = new Date(ts);
  return date.toLocaleString();
}

function formatDuration(startedAt: number, endedAt: number | null): string {
  if (!Number.isFinite(startedAt)) return '';
  const end = Number.isFinite(endedAt ?? NaN) ? (endedAt as number) : Date.now();
  const ms = Math.max(0, end - startedAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}
