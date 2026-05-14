// Read-only BrandEditor (Phase E3.3.b).
//
// Renders an mh2-flavored BrandProfile fetched from the daemon at
// `GET /api/agentcy/brands/:id` (see apps/daemon/src/agentcy/brand-
// routes.ts). The six tabs reflect how operators reason about a brand:
// Identity → Voice → Visual → Audience → Offers → Channels. Each tab
// is a flat <dl> for now; write affordance is E3.3.c.
//
// This is a NEW file (not modifying upstream open-design) so no
// per-file Apache change-notice header is required.

import { useEffect, useMemo, useState } from 'react';

import { navigate } from '../router';

type Tab = 'identity' | 'voice' | 'visual' | 'audience' | 'offers' | 'channels';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'identity', label: 'Identity' },
  { id: 'voice', label: 'Voice' },
  { id: 'visual', label: 'Visual' },
  { id: 'audience', label: 'Audience' },
  { id: 'offers', label: 'Offers' },
  { id: 'channels', label: 'Channels' },
];

export interface BrandEditorProps {
  brandId: string;
  /** Test seam — defaults to window.fetch. */
  fetcher?: typeof fetch;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; profile: Record<string, unknown> }
  | { kind: 'not-found' }
  | { kind: 'malformed'; message: string }
  | { kind: 'error'; message: string };

async function loadProfile(brandId: string, fetcher: typeof fetch): Promise<LoadState> {
  let res: Response;
  try {
    res = await fetcher(`/api/agentcy/brands/${encodeURIComponent(brandId)}`);
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
  if (res.status === 404) return { kind: 'not-found' };
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: 'malformed', message: body.error ?? 'brand.md frontmatter is malformed' };
  }
  if (!res.ok) {
    return { kind: 'error', message: `HTTP ${res.status}` };
  }
  const profile = (await res.json()) as Record<string, unknown>;
  return { kind: 'loaded', profile };
}

export function BrandEditor({ brandId, fetcher }: BrandEditorProps): JSX.Element {
  const fx = fetcher ?? fetch;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('identity');

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void loadProfile(brandId, fx).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [brandId, fx]);

  return (
    <div className="brand-editor" data-testid="brand-editor">
      <header className="brand-editor__header">
        <button
          type="button"
          className="brand-editor__back"
          onClick={() => navigate({ kind: 'home' })}
        >
          ← Home
        </button>
        <h1 className="brand-editor__title">{readableTitle(state, brandId)}</h1>
      </header>

      {state.kind === 'loading' ? (
        <p className="brand-editor__status">Loading {brandId}…</p>
      ) : state.kind === 'not-found' ? (
        <p className="brand-editor__status brand-editor__status--error">
          No brand named <code>{brandId}</code> was found.
        </p>
      ) : state.kind === 'malformed' ? (
        <p className="brand-editor__status brand-editor__status--error">
          Brand file is malformed: {state.message}
        </p>
      ) : state.kind === 'error' ? (
        <p className="brand-editor__status brand-editor__status--error">
          Failed to load brand: {state.message}
        </p>
      ) : (
        <BrandEditorLoaded profile={state.profile} tab={tab} setTab={setTab} />
      )}
    </div>
  );
}

function readableTitle(state: LoadState, brandId: string): string {
  if (state.kind === 'loaded') {
    const name = state.profile.name;
    if (typeof name === 'string' && name) return name;
  }
  return brandId;
}

function BrandEditorLoaded({
  profile,
  tab,
  setTab,
}: {
  profile: Record<string, unknown>;
  tab: Tab;
  setTab: (next: Tab) => void;
}): JSX.Element {
  const tabContent = useMemo(() => renderTab(profile, tab), [profile, tab]);
  return (
    <>
      <nav className="brand-editor__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={
              tab === t.id ? 'brand-editor__tab brand-editor__tab--active' : 'brand-editor__tab'
            }
            data-testid={`brand-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <section
        className="brand-editor__panel"
        role="tabpanel"
        data-testid={`brand-panel-${tab}`}
      >
        {tabContent}
      </section>
    </>
  );
}

function renderTab(profile: Record<string, unknown>, tab: Tab): JSX.Element {
  if (tab === 'identity') {
    return (
      <FieldList
        rows={[
          ['Id', asString(profile.id)],
          ['Name', asString(profile.name)],
          ['Positioning', asString(profile.positioning)],
          ['URL', asString(profile.url)],
          ['Description', asString(profile.description)],
          ['Category', asString(profile.category)],
          ['Brand summary', asString(profile.brand_summary)],
          ['Product type', asString(profile.product_type)],
        ]}
      />
    );
  }
  if (tab === 'voice') {
    const voice = (profile.voice ?? {}) as Record<string, unknown>;
    return (
      <FieldList
        rows={[
          ['Tone', asString(voice.tone)],
          ['Style', asString(voice.style)],
          ['Do', asStringArray(voice.do)],
          ["Don't", asStringArray(voice.dont)],
          ['Adjectives', asStringArray(profile.voice_adjectives)],
          ['Prompt modifier', asString(profile.prompt_modifier)],
        ]}
      />
    );
  }
  if (tab === 'visual') {
    const photo = (profile.photography_direction ?? {}) as Record<string, unknown>;
    const packaging = (profile.packaging_details ?? {}) as Record<string, unknown>;
    const ad = (profile.ad_creative_style ?? {}) as Record<string, unknown>;
    return (
      <>
        <h3 className="brand-editor__section">Photography</h3>
        <FieldList
          rows={[
            ['Lighting', asString(photo.lighting)],
            ['Color grading', asString(photo.color_grading)],
            ['Composition', asString(photo.composition)],
            ['Subject matter', asString(photo.subject_matter)],
            ['Props & surfaces', asString(photo.props_and_surfaces)],
            ['Mood', asString(photo.mood)],
          ]}
        />
        <h3 className="brand-editor__section">Packaging</h3>
        <FieldList
          rows={[
            ['Physical description', asString(packaging.physical_description)],
            ['Label / logo placement', asString(packaging.label_logo_placement)],
            ['Distinctive features', asString(packaging.distinctive_features)],
          ]}
        />
        <h3 className="brand-editor__section">Ad creative style</h3>
        <FieldList
          rows={[
            ['Typical formats', asString(ad.typical_formats)],
            ['Text overlay style', asString(ad.text_overlay_style)],
            ['Photo vs illustration', asString(ad.photo_vs_illustration)],
            ['UGC usage', asString(ad.ugc_usage)],
            ['Offer presentation', asString(ad.offer_presentation)],
          ]}
        />
        <h3 className="brand-editor__section">Palette</h3>
        <FieldList
          rows={[
            ['Primary colors', asStringArray(profile.colors)],
            ['Background colors', asStringArray(profile.background_colors)],
            ['Fonts', asStringArray(profile.fonts)],
          ]}
        />
      </>
    );
  }
  if (tab === 'audience') {
    const audiences = Array.isArray(profile.audiences) ? profile.audiences : [];
    const personas = Array.isArray(profile.personas) ? profile.personas : [];
    return (
      <>
        <h3 className="brand-editor__section">Target audience</h3>
        <FieldList
          rows={[
            ['Summary', asString(profile.target_audience)],
            ['Key benefits', asStringArray(profile.key_benefits)],
            ['USPs', asStringArray(profile.usps)],
          ]}
        />
        <h3 className="brand-editor__section">Audiences ({audiences.length})</h3>
        {audiences.length === 0 ? (
          <p className="brand-editor__empty">No audiences defined.</p>
        ) : (
          <ul className="brand-editor__list">
            {audiences.map((a, i) => {
              const row = a as Record<string, unknown>;
              return (
                <li key={asString(row.id) || `aud-${i}`}>
                  <strong>{asString(row.id) || '(unnamed)'}:</strong> {asString(row.summary) || '—'}
                </li>
              );
            })}
          </ul>
        )}
        <h3 className="brand-editor__section">Personas ({personas.length})</h3>
        {personas.length === 0 ? (
          <p className="brand-editor__empty">No personas defined.</p>
        ) : (
          <ul className="brand-editor__list">
            {personas.map((p, i) => {
              const row = p as Record<string, unknown>;
              return (
                <li key={asString(row.id) || `persona-${i}`}>
                  <strong>{asString(row.name) || asString(row.id) || '(unnamed)'}</strong>
                  {row.age ? <span> · {asString(row.age)}</span> : null}
                  {row.description ? <p>{asString(row.description)}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }
  if (tab === 'offers') {
    const offers = Array.isArray(profile.offers) ? profile.offers : [];
    return (
      <>
        <h3 className="brand-editor__section">Offers ({offers.length})</h3>
        {offers.length === 0 ? (
          <p className="brand-editor__empty">No offers defined.</p>
        ) : (
          <ul className="brand-editor__list">
            {offers.map((o, i) => {
              const row = o as Record<string, unknown>;
              return (
                <li key={asString(row.id) || `offer-${i}`}>
                  <strong>{asString(row.id) || '(unnamed)'}</strong>: {asString(row.summary) || '—'}
                  {row.url ? (
                    <>
                      {' '}
                      <a href={asString(row.url)} target="_blank" rel="noreferrer">
                        link
                      </a>
                    </>
                  ) : null}
                  {row.cta ? <span> · CTA: {asString(row.cta)}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        <h3 className="brand-editor__section">Proof</h3>
        <FieldList
          rows={[
            ['Proof points', asStringArray(profile.proof_points)],
            ['Guarantee', asString(profile.guarantee)],
            ['Competitive differentiation', asString(profile.competitive_differentiation)],
          ]}
        />
      </>
    );
  }
  // channels
  const channels = (profile.channels ?? {}) as Record<string, unknown>;
  const pillars = Array.isArray(profile.pillars) ? profile.pillars : [];
  const formats = Array.isArray(profile.formats) ? profile.formats : [];
  return (
    <>
      <h3 className="brand-editor__section">Channels</h3>
      {Object.keys(channels).length === 0 ? (
        <p className="brand-editor__empty">No channels defined.</p>
      ) : (
        <ul className="brand-editor__list">
          {Object.entries(channels).map(([key, value]) => (
            <li key={key}>
              <strong>{key}</strong>: <code>{JSON.stringify(value)}</code>
            </li>
          ))}
        </ul>
      )}
      <h3 className="brand-editor__section">Pillars ({pillars.length})</h3>
      {pillars.length === 0 ? (
        <p className="brand-editor__empty">No pillars defined.</p>
      ) : (
        <ul className="brand-editor__list">
          {pillars.map((p, i) => {
            const row = p as Record<string, unknown>;
            return (
              <li key={asString(row.id) || `pillar-${i}`}>
                <strong>{asString(row.id) || '(unnamed)'}</strong>
                {row.perspective ? <span>: {asString(row.perspective)}</span> : null}
                {Array.isArray(row.signals) && row.signals.length > 0 ? (
                  <p>Signals: {asStringArray(row.signals)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="brand-editor__section">Formats ({formats.length})</h3>
      {formats.length === 0 ? (
        <p className="brand-editor__empty">No formats defined.</p>
      ) : (
        <ul className="brand-editor__list">
          {formats.map((f, i) => {
            const row = f as Record<string, unknown>;
            return (
              <li key={asString(row.id) || `format-${i}`}>
                <strong>{asString(row.id) || '(unnamed)'}</strong>
                {row.description ? <span>: {asString(row.description)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function FieldList({ rows }: { rows: Array<[string, string]> }): JSX.Element {
  const filled = rows.filter(([, value]) => value && value.length > 0);
  if (filled.length === 0) {
    return <p className="brand-editor__empty">No fields set in this section.</p>;
  }
  return (
    <dl className="brand-editor__fields">
      {filled.map(([label, value]) => (
        <div key={label} className="brand-editor__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asStringArray(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter((v) => typeof v === 'string' && v.length > 0).join(', ');
}
