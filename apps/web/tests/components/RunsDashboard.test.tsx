// @vitest-environment jsdom
//
// E3.3.d — RunsDashboard component tests.
//
// Covers: initial load, filter chips drive query parameters, empty
// state, error banner, status badges, polling while runs are active,
// no-poll once all rows are terminal.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunsDashboard } from '../../src/components/RunsDashboard';

interface CapturedFetch {
  fetcher: typeof fetch;
  calls: string[];
}

function mockFetcher(responses: Array<{ runs: unknown[] }>): CapturedFetch {
  const calls: string[] = [];
  let i = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const body = responses[Math.min(i, responses.length - 1)] ?? { runs: [] };
    i += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const baseRun = {
  brandId: 'givecare',
  startedAt: 1_700_000_000_000,
  endedAt: null,
  exitCode: null,
  errorMessage: null,
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
});

describe('RunsDashboard', () => {
  it('lists runs returned by /api/agentcy/runs and shows their status badges', async () => {
    const { fetcher } = mockFetcher([
      {
        runs: [
          { ...baseRun, runId: 'r5', workflow: 'ad.post', status: 'running' },
          {
            ...baseRun,
            runId: 'r1',
            workflow: 'ad.post',
            status: 'succeeded',
            endedAt: 1_700_000_005_000,
            exitCode: 0,
          },
        ],
      },
    ]);
    render(<RunsDashboard fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('runs-table'));
    expect(screen.getByTestId('runs-row-r5')).toBeTruthy();
    expect(screen.getByTestId('runs-row-r1')).toBeTruthy();
    // Within the row, status badge appears via its specific testid.
    expect(screen.getByTestId('runs-status-running')).toBeTruthy();
    expect(screen.getByTestId('runs-status-succeeded')).toBeTruthy();
  });

  it('renders the empty state when no runs come back', async () => {
    const { fetcher } = mockFetcher([{ runs: [] }]);
    render(<RunsDashboard fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('runs-empty'));
    expect(screen.queryByTestId('runs-table')).toBeNull();
  });

  it('drives status filter into the query string', async () => {
    const { fetcher, calls } = mockFetcher([{ runs: [] }, { runs: [] }]);
    render(<RunsDashboard fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('runs-empty'));
    expect(calls[0]).toBe('/api/agentcy/runs');
    fireEvent.click(screen.getByTestId('runs-filter-status-running'));
    await waitFor(() => calls.length >= 2);
    expect(calls[calls.length - 1]).toBe('/api/agentcy/runs?status=running');
  });

  it('combines status + workflow filters', async () => {
    const { fetcher, calls } = mockFetcher([
      { runs: [] },
      { runs: [] },
      { runs: [] },
    ]);
    render(<RunsDashboard fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('runs-empty'));
    fireEvent.click(screen.getByTestId('runs-filter-status-failed'));
    await waitFor(() => calls.length >= 2);
    fireEvent.click(screen.getByTestId('runs-filter-workflow-email.design'));
    await waitFor(() => calls.length >= 3);
    expect(calls[calls.length - 1]).toBe(
      '/api/agentcy/runs?status=failed&workflow=email.design',
    );
  });

  it('surfaces an error banner when /api/agentcy/runs returns non-200', async () => {
    const fetcher = vi.fn(async () =>
      new Response('{"error":"bad"}', { status: 500 }),
    ) as unknown as typeof fetch;
    render(<RunsDashboard fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('runs-error'));
    expect(screen.getByTestId('runs-error').textContent).toMatch(/HTTP 500/);
  });

  it('row link navigates to /runs/:runId', async () => {
    const { fetcher } = mockFetcher([
      {
        runs: [{ ...baseRun, runId: 'r1', workflow: 'ad.post', status: 'succeeded' }],
      },
    ]);
    render(<RunsDashboard fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('runs-row-link-r1'));
    fireEvent.click(screen.getByTestId('runs-row-link-r1'));
    expect(window.location.pathname).toBe('/runs/r1');
  });

  it('polls while any row is running, stops once all are terminal', async () => {
    vi.useFakeTimers();
    const responses = [
      {
        runs: [
          { ...baseRun, runId: 'r1', workflow: 'ad.post', status: 'running' },
        ],
      },
      {
        runs: [
          {
            ...baseRun,
            runId: 'r1',
            workflow: 'ad.post',
            status: 'succeeded',
            endedAt: 1_700_000_001_000,
          },
        ],
      },
      {
        runs: [
          {
            ...baseRun,
            runId: 'r1',
            workflow: 'ad.post',
            status: 'succeeded',
            endedAt: 1_700_000_001_000,
          },
        ],
      },
    ];
    const { fetcher, calls } = mockFetcher(responses);
    render(<RunsDashboard fetcher={fetcher} pollIntervalMs={100} />);
    // Wait for the first response to settle.
    await vi.waitFor(() => screen.getByTestId('runs-status-running'));
    expect(calls.length).toBe(1);
    expect(screen.getByTestId('runs-polling')).toBeTruthy();
    // Tick once — should trigger a poll that returns the succeeded row.
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => screen.getByTestId('runs-status-succeeded'));
    expect(calls.length).toBe(2);
    // The polling banner disappears now that no row is running.
    expect(screen.queryByTestId('runs-polling')).toBeNull();
    // Further ticks must NOT issue additional polls.
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.length).toBe(2);
  });
});
