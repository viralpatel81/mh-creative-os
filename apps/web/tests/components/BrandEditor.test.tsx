// @vitest-environment jsdom
//
// E3.3.b + E3.3.c — BrandEditor tests.
//
// Identity / Voice / Visual tabs are editable: assertions check input
// values and verify Save dispatches PUT with the right body. Audience /
// Offers / Channels stay read-only this phase and are asserted via
// text content.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrandEditor } from '../../src/components/BrandEditor';
import { BrandsQuickLink } from '../../src/components/BrandsQuickLink';

const profileFixture = {
  id: 'givecare',
  name: 'GiveCare',
  positioning: 'caregiver support',
  url: 'https://givecare.example',
  voice: { tone: 'warm', style: 'plainspoken', do: ['be direct'], dont: ['use jargon'] },
  voice_adjectives: ['warm', 'direct'],
  photography_direction: {
    lighting: 'soft daylight',
    mood: 'hopeful',
    composition: 'rule of thirds',
  },
  packaging_details: { physical_description: 'matte white box' },
  ad_creative_style: { typical_formats: '1:1, 4:5', ugc_usage: 'sparingly' },
  audiences: [{ id: 'family-caregivers', summary: 'Adult children of aging parents' }],
  personas: [
    { id: 'p1', name: 'Maria', age: '52', description: 'Caring for her father' },
  ],
  offers: [{ id: 'pulse', summary: 'Daily caregiver pulse', url: 'https://pulse.example', cta: 'Sign up' }],
  proof_points: ['63M unpaid caregivers in the US'],
  channels: { social: { default_offer: 'pulse' } },
  pillars: [{ id: 'care-economy', perspective: 'systemic', signals: ['policy', 'reform'] }],
  formats: [{ id: 'statement', description: 'Big headline + supporting line' }],
};

function mockFetchJson(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

/**
 * Build a fetcher that returns one response for GET and another for
 * PUT. PUT also captures the body so tests can assert on it.
 */
function mockGetPutFetcher(args: {
  getStatus?: number;
  getBody: unknown;
  putStatus?: number;
  putBody?: unknown;
}): { fetcher: typeof fetch; getPutBody: () => unknown | null } {
  let capturedPutBody: unknown | null = null;
  const fn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT') {
      capturedPutBody = init?.body ? JSON.parse(init.body as string) : null;
      return new Response(
        JSON.stringify(args.putBody ?? capturedPutBody ?? {}),
        {
          status: args.putStatus ?? 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
    return new Response(JSON.stringify(args.getBody), {
      status: args.getStatus ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetcher: fn, getPutBody: () => capturedPutBody };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('BrandEditor — read paths', () => {
  it('renders all six tabs and defaults to Identity', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-identity'));
    for (const tab of ['identity', 'voice', 'visual', 'audience', 'offers', 'channels']) {
      expect(screen.getByTestId(`brand-tab-${tab}`)).toBeTruthy();
    }
    expect(screen.getByTestId('brand-panel-identity')).toBeTruthy();
    // Positioning is now a textarea — verify by display value.
    expect(
      (screen.getByTestId('brand-field-positioning') as HTMLTextAreaElement).value,
    ).toBe('caregiver support');
  });

  it('renders editable inputs on the Voice tab', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-voice'));
    fireEvent.click(screen.getByTestId('brand-tab-voice'));
    expect((screen.getByTestId('brand-field-tone') as HTMLInputElement).value).toBe('warm');
    expect((screen.getByTestId('brand-field-style') as HTMLInputElement).value).toBe('plainspoken');
    // voice_adjectives renders as a comma-separated csv input.
    expect((screen.getByTestId('brand-field-voice_adjectives') as HTMLInputElement).value).toBe(
      'warm, direct',
    );
  });

  it('renders editable inputs on the Visual tab', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-visual'));
    fireEvent.click(screen.getByTestId('brand-tab-visual'));
    expect((screen.getByTestId('brand-field-lighting') as HTMLInputElement).value).toBe(
      'soft daylight',
    );
    expect((screen.getByTestId('brand-field-mood') as HTMLInputElement).value).toBe('hopeful');
    expect(
      (screen.getByTestId('brand-field-physical_description') as HTMLTextAreaElement).value,
    ).toBe('matte white box');
    expect((screen.getByTestId('brand-field-typical_formats') as HTMLInputElement).value).toBe(
      '1:1, 4:5',
    );
  });

  it('renders read-only Audience tab with personas + audiences', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-audience'));
    fireEvent.click(screen.getByTestId('brand-tab-audience'));
    expect(screen.getByText('Maria')).toBeTruthy();
    expect(screen.getByText(/Adult children/)).toBeTruthy();
    expect(screen.getByTestId('brand-viewonly-hint')).toBeTruthy();
  });

  it('renders read-only Offers tab with linked offer URL', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-offers'));
    fireEvent.click(screen.getByTestId('brand-tab-offers'));
    const link = screen.getByText('link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://pulse.example');
    expect(screen.getByText(/Sign up/)).toBeTruthy();
  });

  it('renders read-only Channels tab with pillars + formats', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-channels'));
    fireEvent.click(screen.getByTestId('brand-tab-channels'));
    expect(screen.getByText('care-economy')).toBeTruthy();
    expect(screen.getByText(/Big headline/)).toBeTruthy();
  });

  it('shows not-found state on 404', async () => {
    const fetcher = mockFetchJson(404, { error: 'brand not found' });
    render(<BrandEditor brandId="nope" fetcher={fetcher} />);
    await waitFor(() => screen.getByText(/No brand named/));
    expect(screen.queryByTestId('brand-tab-identity')).toBeNull();
  });

  it('shows malformed banner on 422', async () => {
    const fetcher = mockFetchJson(422, { error: 'invalid YAML frontmatter: bad' });
    render(<BrandEditor brandId="broken" fetcher={fetcher} />);
    await waitFor(() => screen.getByText(/Brand file is malformed/));
    expect(screen.getByText(/invalid YAML/)).toBeTruthy();
  });

  it('renders the brand id when the loaded profile has no name', async () => {
    const fetcher = mockFetchJson(200, { id: 'noname' });
    render(<BrandEditor brandId="noname" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-identity'));
    expect(screen.getAllByText('noname').length).toBeGreaterThan(0);
  });
});

describe('BrandEditor — write affordance', () => {
  it('disables Save + Discard until an edit happens', async () => {
    const { fetcher } = mockGetPutFetcher({ getBody: profileFixture });
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-save'));
    expect((screen.getByTestId('brand-save') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('brand-discard') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Save once the user changes a field, then PUTs the draft', async () => {
    const { fetcher, getPutBody } = mockGetPutFetcher({ getBody: profileFixture });
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-field-positioning'));
    const positioning = screen.getByTestId('brand-field-positioning') as HTMLTextAreaElement;
    fireEvent.change(positioning, { target: { value: 'caregiver platform' } });
    expect((screen.getByTestId('brand-save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('brand-save'));
    await waitFor(() => screen.getByTestId('brand-save-status-saved'));
    const body = getPutBody() as Record<string, unknown> | null;
    expect(body?.id).toBe('givecare');
    expect(body?.positioning).toBe('caregiver platform');
  });

  it('Discard reverts dirty edits to the last loaded baseline', async () => {
    const { fetcher } = mockGetPutFetcher({ getBody: profileFixture });
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-field-positioning'));
    const field = screen.getByTestId('brand-field-positioning') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'experimental' } });
    expect(field.value).toBe('experimental');
    fireEvent.click(screen.getByTestId('brand-discard'));
    expect(
      (screen.getByTestId('brand-field-positioning') as HTMLTextAreaElement).value,
    ).toBe('caregiver support');
    expect((screen.getByTestId('brand-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('serializes voice_adjectives back as an array of strings', async () => {
    const { fetcher, getPutBody } = mockGetPutFetcher({ getBody: profileFixture });
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-voice'));
    fireEvent.click(screen.getByTestId('brand-tab-voice'));
    const adjectives = screen.getByTestId('brand-field-voice_adjectives') as HTMLInputElement;
    fireEvent.change(adjectives, { target: { value: 'warm, direct, curious' } });
    fireEvent.click(screen.getByTestId('brand-save'));
    await waitFor(() => screen.getByTestId('brand-save-status-saved'));
    const body = getPutBody() as Record<string, unknown> | null;
    expect(body?.voice_adjectives).toEqual(['warm', 'direct', 'curious']);
  });

  it('writes nested photography_direction without losing siblings', async () => {
    const { fetcher, getPutBody } = mockGetPutFetcher({ getBody: profileFixture });
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-visual'));
    fireEvent.click(screen.getByTestId('brand-tab-visual'));
    const lighting = screen.getByTestId('brand-field-lighting') as HTMLInputElement;
    fireEvent.change(lighting, { target: { value: 'overcast' } });
    fireEvent.click(screen.getByTestId('brand-save'));
    await waitFor(() => screen.getByTestId('brand-save-status-saved'));
    const body = getPutBody() as Record<string, unknown> | null;
    const photo = body?.photography_direction as Record<string, unknown>;
    expect(photo.lighting).toBe('overcast');
    // mood + composition came in via baseline and must survive.
    expect(photo.mood).toBe('hopeful');
    expect(photo.composition).toBe('rule of thirds');
  });

  it('surfaces an error banner and leaves the draft dirty when the daemon returns 4xx', async () => {
    const { fetcher } = mockGetPutFetcher({
      getBody: profileFixture,
      putStatus: 422,
      putBody: { error: 'invalid YAML frontmatter: oops' },
    });
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-field-positioning'));
    fireEvent.change(screen.getByTestId('brand-field-positioning'), {
      target: { value: 'breaks YAML' },
    });
    fireEvent.click(screen.getByTestId('brand-save'));
    await waitFor(() => screen.getByTestId('brand-save-status-error'));
    expect(screen.getByTestId('brand-save-status-error').textContent).toMatch(/invalid YAML/);
    // Draft stays dirty: Save remains clickable, baseline unchanged.
    expect((screen.getByTestId('brand-save') as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByTestId('brand-field-positioning') as HTMLTextAreaElement).value,
    ).toBe('breaks YAML');
  });

  it('id field is read-only', async () => {
    const { fetcher } = mockGetPutFetcher({ getBody: profileFixture });
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-field-id-readonly'));
    expect(screen.getByTestId('brand-field-id-readonly').textContent).toBe('givecare');
  });
});

describe('BrandsQuickLink', () => {
  it('renders chips for each brand the daemon returns', async () => {
    const fetcher = mockFetchJson(200, {
      brands: [
        { id: 'givecare', name: 'GiveCare' },
        { id: 'scty', name: 'Society' },
      ],
    });
    render(<BrandsQuickLink fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brands-quick-link'));
    expect(screen.getByTestId('brand-chip-givecare').textContent).toBe('GiveCare');
    expect(screen.getByTestId('brand-chip-scty').textContent).toBe('Society');
  });

  it('navigates to /brands/:id when a chip is clicked', async () => {
    const fetcher = mockFetchJson(200, {
      brands: [{ id: 'givecare', name: 'GiveCare' }],
    });
    render(<BrandsQuickLink fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-chip-givecare'));
    fireEvent.click(screen.getByTestId('brand-chip-givecare'));
    expect(window.location.pathname).toBe('/brands/givecare');
  });

  it('renders the Runs link even when no brands are returned', async () => {
    const fetcher = mockFetchJson(200, { brands: [] });
    render(<BrandsQuickLink fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brands-quick-link'));
    expect(screen.getByTestId('runs-link')).toBeTruthy();
    expect(screen.queryByText(/^Brands:$/)).toBeNull();
  });

  it('Runs link navigates to /runs', async () => {
    const fetcher = mockFetchJson(200, { brands: [] });
    render(<BrandsQuickLink fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('runs-link'));
    fireEvent.click(screen.getByTestId('runs-link'));
    expect(window.location.pathname).toBe('/runs');
  });

  it('still renders nothing while the fetch is in flight (no flash)', async () => {
    // A fetcher that never resolves — the component should not render
    // anything before brands is set.
    const fetcher = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;
    const { container } = render(<BrandsQuickLink fetcher={fetcher} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="brands-quick-link"]')).toBeNull();
  });

  it('renders the Runs link even when the daemon errors (brands set to [])', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    render(<BrandsQuickLink fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brands-quick-link'));
    expect(screen.getByTestId('runs-link')).toBeTruthy();
  });
});
