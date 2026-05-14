// @vitest-environment jsdom
//
// E3.3.f + E3.3.g — RequestForm + BrandEditor launch glue tests.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrandEditor } from '../../src/components/BrandEditor';
import { RequestForm } from '../../src/components/RequestForm';

interface CallLog {
  url: string;
  method: string;
  body: unknown;
}

function mockFetcher(routes: Record<string, (call: CallLog) => Response>): {
  fetcher: typeof fetch;
  calls: CallLog[];
} {
  const calls: CallLog[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const call = { url, method, body };
    calls.push(call);
    // First match by exact path + method, fall back to path-only.
    const key = `${method} ${url.split('?')[0]}`;
    const exact = routes[key];
    if (exact) return exact(call);
    const pathOnly = routes[url.split('?')[0]!];
    if (pathOnly) return pathOnly(call);
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const brandsList = {
  brands: [
    { id: 'givecare', name: 'GiveCare' },
    { id: 'scty', name: 'Society' },
  ],
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('RequestForm — ad.post', () => {
  it('renders with the prefilled brand selected', async () => {
    const { fetcher } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(<RequestForm workflow="ad.post" prefilledBrandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('rf-brand'));
    expect((screen.getByTestId('rf-brand') as HTMLSelectElement).value).toBe('givecare');
    expect(screen.getByTestId('rf-aspect-1:1')).toBeTruthy();
    expect(screen.getByTestId('rf-aspect-3:4')).toBeTruthy();
    expect(screen.getByTestId('rf-aspect-9:16')).toBeTruthy();
    expect(screen.getByTestId('rf-layout-strategy')).toBeTruthy();
    expect(screen.queryByTestId('rf-purpose')).toBeNull();
  });

  it('POSTs to /api/agentcy/runs/workflow and navigates to /runs/:runId', async () => {
    const { fetcher, calls } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      'POST /api/agentcy/runs/workflow': () =>
        new Response(JSON.stringify({ runId: 'r_new' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(<RequestForm workflow="ad.post" prefilledBrandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('rf-brand'));
    fireEvent.change(screen.getByTestId('rf-brief'), { target: { value: 'caregiver gap' } });
    fireEvent.click(screen.getByTestId('rf-aspect-3:4'));
    fireEvent.click(screen.getByTestId('rf-submit'));
    await waitFor(() => window.location.pathname === '/runs/r_new');
    expect(window.location.pathname).toBe('/runs/r_new');
    const postCall = calls.find((c) => c.method === 'POST');
    expect(postCall?.url).toBe('/api/agentcy/runs/workflow');
    const body = postCall?.body as Record<string, unknown>;
    expect(body.workflow).toBe('ad.post');
    expect(body.brand_id).toBe('givecare');
    const params = body.params as Record<string, unknown>;
    expect(params.aspects).toEqual(['1:1', '3:4']);
    expect(params.engine).toBe('gemini');
    expect(params.layout_mode).toBe('strategy');
    expect(params.brief_text).toBe('caregiver gap');
  });

  it('surfaces a daemon error and stays on the form', async () => {
    const { fetcher } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      'POST /api/agentcy/runs/workflow': () =>
        new Response(JSON.stringify({ error: 'aspects must be non-empty' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(<RequestForm workflow="ad.post" prefilledBrandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('rf-submit'));
    fireEvent.click(screen.getByTestId('rf-submit'));
    await waitFor(() => screen.getByTestId('rf-error'));
    expect(screen.getByTestId('rf-error').textContent).toMatch(/aspects must be non-empty/);
    // Still on the form (no navigation).
    expect(window.location.pathname).not.toBe('/runs/r_new');
  });

  it('blocks submit when no brand is selected', async () => {
    const { fetcher, calls } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(<RequestForm workflow="ad.post" prefilledBrandId={null} fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('rf-brand'));
    expect((screen.getByTestId('rf-submit') as HTMLButtonElement).disabled).toBe(true);
    // No POST attempted.
    expect(calls.find((c) => c.method === 'POST')).toBeUndefined();
  });
});

describe('RequestForm — email.design', () => {
  it('exposes the email purpose dropdown and posts the chosen value', async () => {
    const { fetcher, calls } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      'POST /api/agentcy/runs/workflow': () =>
        new Response(JSON.stringify({ runId: 'r_email' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(
      <RequestForm workflow="email.design" prefilledBrandId="givecare" fetcher={fetcher} />,
    );
    await waitFor(() => screen.getByTestId('rf-purpose'));
    fireEvent.change(screen.getByTestId('rf-purpose'), { target: { value: 'abandoned-cart' } });
    fireEvent.click(screen.getByTestId('rf-submit'));
    await waitFor(() => window.location.pathname === '/runs/r_email');
    const postCall = calls.find((c) => c.method === 'POST');
    const params = (postCall?.body as Record<string, unknown>).params as Record<string, unknown>;
    expect(params.purpose).toBe('abandoned-cart');
    // No layout_mode on email path.
    expect(params.layout_mode).toBeUndefined();
  });
});

describe('RequestForm — popup.design', () => {
  it('uses popup-specific aspects + purposes', async () => {
    const { fetcher } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(
      <RequestForm workflow="popup.design" prefilledBrandId="givecare" fetcher={fetcher} />,
    );
    await waitFor(() => screen.getByTestId('rf-purpose'));
    expect(screen.getByTestId('rf-aspect-1:1')).toBeTruthy();
    expect(screen.getByTestId('rf-aspect-4:5')).toBeTruthy();
    expect(screen.getByTestId('rf-aspect-3:4')).toBeTruthy();
    // ad-only aspect is absent.
    expect(screen.queryByTestId('rf-aspect-9:16')).toBeNull();
    const purposes = screen.getByTestId('rf-purpose') as HTMLSelectElement;
    expect(purposes.value).toBe('email-capture');
  });
});

describe('RequestForm — native agentcy workflows', () => {
  it('shows topic / pillar / format inputs for social.post (no aspects)', async () => {
    const { fetcher } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(<RequestForm workflow="social.post" prefilledBrandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('rf-topic'));
    expect(screen.getByTestId('rf-pillar')).toBeTruthy();
    expect(screen.getByTestId('rf-format')).toBeTruthy();
    // No aspect/purpose/layout/engine/quantity rows on the native form.
    expect(screen.queryByTestId('rf-aspect-1:1')).toBeNull();
    expect(screen.queryByTestId('rf-purpose')).toBeNull();
    expect(screen.queryByTestId('rf-layout-strategy')).toBeNull();
    expect(screen.queryByTestId('rf-engine-gemini')).toBeNull();
  });

  it('POSTs only the native params (topic + pillar + format + brief_text)', async () => {
    const { fetcher, calls } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      'POST /api/agentcy/runs/workflow': () =>
        new Response(JSON.stringify({ runId: 'r_social' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(<RequestForm workflow="social.post" prefilledBrandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('rf-topic'));
    fireEvent.change(screen.getByTestId('rf-topic'), { target: { value: 'caregiver gap' } });
    fireEvent.change(screen.getByTestId('rf-pillar'), { target: { value: 'care-economy' } });
    fireEvent.change(screen.getByTestId('rf-format'), { target: { value: 'infographic' } });
    fireEvent.change(screen.getByTestId('rf-brief'), { target: { value: 'angle: $470B' } });
    fireEvent.click(screen.getByTestId('rf-submit'));
    await waitFor(() => window.location.pathname === '/runs/r_social');
    const postCall = calls.find((c) => c.method === 'POST');
    const body = postCall?.body as Record<string, unknown>;
    expect(body.workflow).toBe('social.post');
    expect(body.brand_id).toBe('givecare');
    const params = body.params as Record<string, unknown>;
    expect(params.topic).toBe('caregiver gap');
    expect(params.pillar).toBe('care-economy');
    expect(params.format).toBe('infographic');
    expect(params.brief_text).toBe('angle: $470B');
    // No mh2-specific params leak in.
    expect(params.aspects).toBeUndefined();
    expect(params.engine).toBeUndefined();
    expect(params.layout_mode).toBeUndefined();
    expect(params.purpose).toBeUndefined();
  });

  it('blog.post / outreach.touch / respond.reply all render the native form', async () => {
    for (const wf of ['blog.post', 'outreach.touch', 'respond.reply'] as const) {
      const { fetcher } = mockFetcher({
        '/api/agentcy/brands': () =>
          new Response(JSON.stringify(brandsList), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      });
      const { unmount } = render(
        <RequestForm workflow={wf} prefilledBrandId="givecare" fetcher={fetcher} />,
      );
      await waitFor(() => screen.getByTestId('rf-topic'));
      expect(screen.queryByTestId('rf-aspect-1:1')).toBeNull();
      unmount();
      cleanup();
    }
  });

  it('blocks submit on missing brand even on the native form', async () => {
    const { fetcher } = mockFetcher({
      '/api/agentcy/brands': () =>
        new Response(JSON.stringify(brandsList), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    render(<RequestForm workflow="social.post" prefilledBrandId={null} fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('rf-topic'));
    expect((screen.getByTestId('rf-submit') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('BrandEditor launch glue (E3.3.g + .h)', () => {
  function getFetcher(): typeof fetch {
    return vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'givecare',
          name: 'GiveCare',
          positioning: 'caregiver support',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
  }

  it('renders Launch buttons for all seven workflows', async () => {
    render(<BrandEditor brandId="givecare" fetcher={getFetcher()} />);
    await waitFor(() => screen.getByTestId('brand-launch-menu'));
    // Native agentcy workflows
    expect(screen.getByTestId('brand-launch-social.post')).toBeTruthy();
    expect(screen.getByTestId('brand-launch-blog.post')).toBeTruthy();
    expect(screen.getByTestId('brand-launch-outreach.touch')).toBeTruthy();
    expect(screen.getByTestId('brand-launch-respond.reply')).toBeTruthy();
    // mh2-imported workflows
    expect(screen.getByTestId('brand-launch-ad.post')).toBeTruthy();
    expect(screen.getByTestId('brand-launch-email.design')).toBeTruthy();
    expect(screen.getByTestId('brand-launch-popup.design')).toBeTruthy();
  });

  it('Launch ad navigates to /runs/new/ad.post?brand=:id', async () => {
    render(<BrandEditor brandId="givecare" fetcher={getFetcher()} />);
    await waitFor(() => screen.getByTestId('brand-launch-ad.post'));
    fireEvent.click(screen.getByTestId('brand-launch-ad.post'));
    expect(window.location.pathname).toBe('/runs/new/ad.post');
    expect(window.location.search).toBe('?brand=givecare');
  });

  it('Launch social post navigates to /runs/new/social.post?brand=:id', async () => {
    render(<BrandEditor brandId="givecare" fetcher={getFetcher()} />);
    await waitFor(() => screen.getByTestId('brand-launch-social.post'));
    fireEvent.click(screen.getByTestId('brand-launch-social.post'));
    expect(window.location.pathname).toBe('/runs/new/social.post');
    expect(window.location.search).toBe('?brand=givecare');
  });
});
