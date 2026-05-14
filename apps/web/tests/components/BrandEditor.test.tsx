// @vitest-environment jsdom
//
// E3.3.b — BrandEditor read-only component tests.
//
// Coverage:
//   - Renders all six tabs, defaults to Identity.
//   - Tab switch shows the expected fields (mh2 extension fields:
//     photography_direction, packaging_details, ad_creative_style,
//     voice_adjectives, etc.).
//   - 404 surfaces an empty-state.
//   - 422 surfaces a malformed-banner.
//   - BrandsQuickLink hides when daemon returns no brands and renders
//     chips that deep-link to /brands/:id when brands exist.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  // BrandEditor's "Back to home" button calls navigate(). The tiny
  // router uses window.history.pushState which jsdom supports.
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('BrandEditor', () => {
  it('renders all six tabs and defaults to Identity', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-identity'));
    for (const tab of ['identity', 'voice', 'visual', 'audience', 'offers', 'channels']) {
      expect(screen.getByTestId(`brand-tab-${tab}`)).toBeTruthy();
    }
    // Default panel is identity — positioning is visible.
    expect(screen.getByText('caregiver support')).toBeTruthy();
    expect(screen.getByTestId('brand-panel-identity')).toBeTruthy();
  });

  it('switches to the Voice tab and shows tone + adjectives', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-voice'));
    fireEvent.click(screen.getByTestId('brand-tab-voice'));
    expect(screen.getByTestId('brand-panel-voice')).toBeTruthy();
    expect(screen.getByText('warm')).toBeTruthy(); // tone
    expect(screen.getByText('plainspoken')).toBeTruthy(); // style
    expect(screen.getByText('warm, direct')).toBeTruthy(); // adjectives joined
  });

  it('switches to Visual and shows photography + ad creative fields', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-visual'));
    fireEvent.click(screen.getByTestId('brand-tab-visual'));
    expect(screen.getByText('soft daylight')).toBeTruthy(); // lighting
    expect(screen.getByText('hopeful')).toBeTruthy(); // mood
    expect(screen.getByText('matte white box')).toBeTruthy(); // packaging
    expect(screen.getByText('1:1, 4:5')).toBeTruthy(); // ad creative formats
  });

  it('switches to Audience and renders personas + audiences', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-audience'));
    fireEvent.click(screen.getByTestId('brand-tab-audience'));
    expect(screen.getByText('Maria')).toBeTruthy();
    expect(screen.getByText(/Adult children/)).toBeTruthy();
  });

  it('switches to Offers and links the offer URL', async () => {
    const fetcher = mockFetchJson(200, profileFixture);
    render(<BrandEditor brandId="givecare" fetcher={fetcher} />);
    await waitFor(() => screen.getByTestId('brand-tab-offers'));
    fireEvent.click(screen.getByTestId('brand-tab-offers'));
    const link = screen.getByText('link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://pulse.example');
    expect(screen.getByText(/Sign up/)).toBeTruthy();
  });

  it('switches to Channels and lists pillars + formats', async () => {
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
    // Title falls back to the brandId.
    expect(screen.getAllByText('noname').length).toBeGreaterThan(0);
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

  it('renders nothing when the daemon returns no brands', async () => {
    const fetcher = mockFetchJson(200, { brands: [] });
    const { container } = render(<BrandsQuickLink fetcher={fetcher} />);
    // Wait one microtask so the effect resolves.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="brands-quick-link"]')).toBeNull();
  });

  it('renders nothing when the daemon errors', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const { container } = render(<BrandsQuickLink fetcher={fetcher} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="brands-quick-link"]')).toBeNull();
  });
});
