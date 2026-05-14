// @vitest-environment jsdom
//
// E3.3.e — RunDetail component tests.
//
// SSE parsing is exercised via a fetch mock whose body is a
// ReadableStream we feed pre-formatted text/event-stream chunks
// into. This keeps the test path identical to the real path (the
// component reads the body via getReader()) and works under jsdom
// because Node 18+ has a global ReadableStream.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunDetail } from '../../src/components/RunDetail';

const runSnapshot = {
  runId: 'r1',
  workflow: 'ad.post',
  brandId: 'givecare',
  status: 'running' as const,
  startedAt: 1_700_000_000_000,
  endedAt: null,
  exitCode: null,
  errorMessage: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function sseEvent(kind: string, payload: Record<string, unknown>, seq?: number): string {
  const idPrefix = typeof seq === 'number' ? `id: ${seq}\n` : '';
  return `${idPrefix}event: ${kind}\ndata: ${JSON.stringify({ ...payload, kind, ...(seq !== undefined ? { seq } : {}) })}\n\n`;
}

interface MockFetchOptions {
  snapshot?: unknown;
  snapshotStatus?: number;
  sseChunks?: string[];
}

function mockFetch(opts: MockFetchOptions): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/events')) {
      return sseResponse(opts.sseChunks ?? []);
    }
    return jsonResponse(opts.snapshot ?? runSnapshot, opts.snapshotStatus ?? 200);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('RunDetail', () => {
  it('renders the snapshot header (workflow, brand, status badge)', async () => {
    const fetcher = mockFetch({});
    render(<RunDetail runId="r1" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('run-detail-status-running'));
    expect(screen.getByText('ad.post')).toBeTruthy();
    expect(screen.getByText('givecare')).toBeTruthy();
  });

  it('shows a not-found banner when the snapshot returns 404', async () => {
    const fetcher = mockFetch({ snapshot: { error: 'nope' }, snapshotStatus: 404 });
    render(<RunDetail runId="ghost" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('run-detail-error'));
    expect(screen.getByTestId('run-detail-error').textContent).toMatch(/Run not found/);
  });

  it('appends events from the SSE stream into the timeline', async () => {
    const fetcher = mockFetch({
      sseChunks: [
        sseEvent('step.start', { runId: 'r1', step: 'render' }, 1),
        sseEvent('step.end', { runId: 'r1', step: 'render', durationMs: 42 }, 2),
        sseEvent('log', { runId: 'r1', level: 'info', message: 'all good' }, 3),
      ],
    });
    render(<RunDetail runId="r1" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('timeline-row-step.start'));
    await waitFor(() => screen.getByTestId('timeline-row-step.end'));
    await waitFor(() => screen.getByTestId('timeline-row-log'));
    expect(screen.getByText('render (42ms)')).toBeTruthy();
    expect(screen.getByText('[info] all good')).toBeTruthy();
  });

  it('renders an image artifact card with the daemon-resolved URL', async () => {
    const fetcher = mockFetch({
      sseChunks: [
        sseEvent(
          'artifact.written',
          {
            runId: 'r1',
            type: 'image/png',
            path: 'state/artifacts/r1/ad-1x1.png',
            identifier: 'ad-1x1',
            title: 'Caregiver 1:1',
          },
          1,
        ),
      ],
    });
    render(<RunDetail runId="r1" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('run-artifact-image-ad-1x1'));
    const img = screen.getByTestId('run-artifact-image-ad-1x1') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/agentcy/artifacts/r1/ad-1x1.png');
    expect(img.getAttribute('alt')).toBe('Caregiver 1:1');
  });

  it('renders a non-image artifact as a code path (no <img>)', async () => {
    const fetcher = mockFetch({
      sseChunks: [
        sseEvent(
          'artifact.written',
          {
            runId: 'r1',
            type: 'application/json',
            path: 'state/artifacts/r1/run_result.json',
            identifier: 'rr',
          },
          1,
        ),
      ],
    });
    render(<RunDetail runId="r1" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('run-artifact-rr'));
    expect(screen.queryByTestId('run-artifact-image-rr')).toBeNull();
    expect(screen.getByText('state/artifacts/r1/run_result.json')).toBeTruthy();
  });

  it('updates the header status when the terminal `end` event arrives', async () => {
    const fetcher = mockFetch({
      sseChunks: [
        sseEvent('step.start', { runId: 'r1', step: 'render' }, 1),
        sseEvent('end', { runId: 'r1', status: 'succeeded', exitCode: 0 }, 2),
      ],
    });
    render(<RunDetail runId="r1" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('run-detail-status-succeeded'));
  });

  it('dedups events with the same seq across reconnects', async () => {
    // Two chunks arriving in two reads — the test stream is one
    // response, but we exercise dedup by intentionally repeating
    // seq=1.
    const fetcher = mockFetch({
      sseChunks: [
        sseEvent('step.start', { runId: 'r1', step: 'render' }, 1),
        sseEvent('step.start', { runId: 'r1', step: 'render' }, 1), // duplicate
        sseEvent('step.end', { runId: 'r1', step: 'render', durationMs: 7 }, 2),
      ],
    });
    render(<RunDetail runId="r1" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('timeline-row-step.end'));
    // Only one step.start row should exist.
    expect(screen.getAllByTestId('timeline-row-step.start').length).toBe(1);
  });

  it('back button navigates to /runs', async () => {
    const fetcher = mockFetch({});
    render(<RunDetail runId="r1" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('run-detail-status-running'));
    fireEvent.click(screen.getByText('← Runs'));
    expect(window.location.pathname).toBe('/runs');
  });
});
