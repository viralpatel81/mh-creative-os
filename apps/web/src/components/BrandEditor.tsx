// BrandEditor (Phase E3.3.b + E3.3.c).
//
// Reads /api/agentcy/brands/:id and renders a six-tab view of an
// mh2-flavored BrandProfile. Three tabs are editable (Identity,
// Voice, Visual); the rest stay read-only this commit because the
// collection-of-objects shapes (personas, audiences, offers) need
// richer add/remove UI we'll layer in later.
//
// Save dispatches PUT /api/agentcy/brands/:id and re-syncs local
// state from the daemon's round-tripped response. Discard reverts
// to the last-loaded profile. Dirty tracking is a deep-equal check
// against that pristine baseline.
//
// New file — no Apache change-notice needed.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { navigate } from '../router';

type Tab = 'identity' | 'voice' | 'visual' | 'audience' | 'offers' | 'channels';

const TABS: Array<{ id: Tab; label: string; editable: boolean }> = [
  { id: 'identity', label: 'Identity', editable: true },
  { id: 'voice', label: 'Voice', editable: true },
  { id: 'visual', label: 'Visual', editable: true },
  { id: 'audience', label: 'Audience', editable: false },
  { id: 'offers', label: 'Offers', editable: false },
  { id: 'channels', label: 'Channels', editable: false },
];

type BrandProfile = Record<string, unknown>;

export interface BrandEditorProps {
  brandId: string;
  /** Test seam — defaults to window.fetch. */
  fetcher?: typeof fetch;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; baseline: BrandProfile; draft: BrandProfile }
  | { kind: 'not-found' }
  | { kind: 'malformed'; message: string }
  | { kind: 'error'; message: string };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'saved' };

async function fetchProfile(brandId: string, fetcher: typeof fetch): Promise<LoadState> {
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
  if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };
  const profile = (await res.json()) as BrandProfile;
  return { kind: 'loaded', baseline: profile, draft: profile };
}

export function BrandEditor({ brandId, fetcher }: BrandEditorProps): JSX.Element {
  const fx = fetcher ?? fetch;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('identity');
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    setSaveState({ kind: 'idle' });
    void fetchProfile(brandId, fx).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [brandId, fx]);

  const updateDraft = useCallback(
    (mutator: (prev: BrandProfile) => BrandProfile) => {
      setState((prev) => {
        if (prev.kind !== 'loaded') return prev;
        return { ...prev, draft: mutator(prev.draft) };
      });
      setSaveState((prev) => (prev.kind === 'saved' ? { kind: 'idle' } : prev));
    },
    [],
  );

  const dirty = useMemo(() => {
    if (state.kind !== 'loaded') return false;
    return !deepEqual(state.baseline, state.draft);
  }, [state]);

  const onDiscard = useCallback(() => {
    setState((prev) => (prev.kind === 'loaded' ? { ...prev, draft: prev.baseline } : prev));
    setSaveState({ kind: 'idle' });
  }, []);

  const onSave = useCallback(async () => {
    if (state.kind !== 'loaded' || !dirty) return;
    setSaveState({ kind: 'saving' });
    let res: Response;
    try {
      res = await fx(`/api/agentcy/brands/${encodeURIComponent(brandId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state.draft),
      });
    } catch (err) {
      setSaveState({ kind: 'error', message: (err as Error).message });
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveState({ kind: 'error', message: body.error ?? `HTTP ${res.status}` });
      return;
    }
    const next = (await res.json()) as BrandProfile;
    setState({ kind: 'loaded', baseline: next, draft: next });
    setSaveState({ kind: 'saved' });
  }, [brandId, fx, state, dirty]);

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
        {state.kind === 'loaded' ? (
          <div className="brand-editor__actions">
            <LaunchMenu brandId={brandId} />
            <button
              type="button"
              data-testid="brand-discard"
              onClick={onDiscard}
              disabled={!dirty || saveState.kind === 'saving'}
            >
              Discard
            </button>
            <button
              type="button"
              data-testid="brand-save"
              onClick={() => {
                void onSave();
              }}
              disabled={!dirty || saveState.kind === 'saving'}
            >
              {saveState.kind === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {saveState.kind === 'saved' ? (
              <span className="brand-editor__save-status" data-testid="brand-save-status-saved">
                Saved
              </span>
            ) : null}
            {saveState.kind === 'error' ? (
              <span
                className="brand-editor__save-status brand-editor__save-status--error"
                data-testid="brand-save-status-error"
              >
                {saveState.message}
              </span>
            ) : null}
          </div>
        ) : null}
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
        <BrandEditorLoaded
          draft={state.draft}
          tab={tab}
          setTab={setTab}
          updateDraft={updateDraft}
        />
      )}
    </div>
  );
}

function LaunchMenu({ brandId }: { brandId: string }): JSX.Element {
  // Grouped into two rows: native agentcy workflows on top (social,
  // blog, outreach, respond), mh2-imported creative workflows below
  // (ad, email, popup). The ordering signals that agentcy is the
  // platform and the mh2 imports are an extension layer.
  const groups = [
    {
      label: 'Agentcy',
      items: [
        ['social.post', 'Social post'],
        ['blog.post', 'Blog post'],
        ['outreach.touch', 'Outreach touch'],
        ['respond.reply', 'Respond / reply'],
      ] as const,
    },
    {
      label: 'Creative',
      items: [
        ['ad.post', 'Ad'],
        ['email.design', 'Email'],
        ['popup.design', 'Popup'],
      ] as const,
    },
  ];
  return (
    <div className="brand-editor__launch" data-testid="brand-launch-menu">
      {groups.map((group) => (
        <div key={group.label} className="brand-editor__launch-group">
          <span className="brand-editor__launch-label">{group.label}:</span>
          {group.items.map(([workflow, label]) => (
            <button
              key={workflow}
              type="button"
              data-testid={`brand-launch-${workflow}`}
              onClick={() => navigate({ kind: 'runs-new', workflow, brandId })}
            >
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function readableTitle(state: LoadState, brandId: string): string {
  if (state.kind === 'loaded') {
    const name = state.draft.name;
    if (typeof name === 'string' && name) return name;
  }
  return brandId;
}

function BrandEditorLoaded({
  draft,
  tab,
  setTab,
  updateDraft,
}: {
  draft: BrandProfile;
  tab: Tab;
  setTab: (next: Tab) => void;
  updateDraft: (mutator: (prev: BrandProfile) => BrandProfile) => void;
}): JSX.Element {
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
            {!t.editable ? <span className="brand-editor__tab-badge"> (view)</span> : null}
          </button>
        ))}
      </nav>
      <section
        className="brand-editor__panel"
        role="tabpanel"
        data-testid={`brand-panel-${tab}`}
      >
        {renderTab(draft, tab, updateDraft)}
      </section>
    </>
  );
}

function renderTab(
  draft: BrandProfile,
  tab: Tab,
  updateDraft: (mutator: (prev: BrandProfile) => BrandProfile) => void,
): JSX.Element {
  if (tab === 'identity') {
    return (
      <EditableFieldList
        rows={[
          { label: 'Id', key: 'id', value: asString(draft.id), readOnly: true },
          { label: 'Name', key: 'name', value: asString(draft.name) },
          {
            label: 'Positioning',
            key: 'positioning',
            value: asString(draft.positioning),
            multiline: true,
          },
          { label: 'URL', key: 'url', value: asString(draft.url) },
          {
            label: 'Description',
            key: 'description',
            value: asString(draft.description),
            multiline: true,
          },
          { label: 'Category', key: 'category', value: asString(draft.category) },
          {
            label: 'Brand summary',
            key: 'brand_summary',
            value: asString(draft.brand_summary),
            multiline: true,
          },
          { label: 'Product type', key: 'product_type', value: asString(draft.product_type) },
        ]}
        onChange={(key, next) =>
          updateDraft((prev) => ({ ...prev, [key]: next }))
        }
      />
    );
  }
  if (tab === 'voice') {
    const voice = (draft.voice ?? {}) as Record<string, unknown>;
    return (
      <>
        <EditableFieldList
          rows={[
            { label: 'Tone', key: 'tone', value: asString(voice.tone) },
            { label: 'Style', key: 'style', value: asString(voice.style) },
            {
              label: 'Do (one per line)',
              key: 'do',
              value: asLines(voice.do),
              multiline: true,
            },
            {
              label: "Don't (one per line)",
              key: 'dont',
              value: asLines(voice.dont),
              multiline: true,
            },
          ]}
          onChange={(key, next) =>
            updateDraft((prev) => ({
              ...prev,
              voice: {
                ...((prev.voice ?? {}) as Record<string, unknown>),
                [key]:
                  key === 'do' || key === 'dont' ? parseLines(next) : next,
              },
            }))
          }
        />
        <h3 className="brand-editor__section">Voice adjectives</h3>
        <EditableFieldList
          rows={[
            {
              label: 'Adjectives (comma-separated)',
              key: 'voice_adjectives',
              value: asCsv(draft.voice_adjectives),
            },
            { label: 'Prompt modifier', key: 'prompt_modifier', value: asString(draft.prompt_modifier), multiline: true },
          ]}
          onChange={(key, next) =>
            updateDraft((prev) => ({
              ...prev,
              [key]: key === 'voice_adjectives' ? parseCsv(next) : next,
            }))
          }
        />
      </>
    );
  }
  if (tab === 'visual') {
    const photo = (draft.photography_direction ?? {}) as Record<string, unknown>;
    const packaging = (draft.packaging_details ?? {}) as Record<string, unknown>;
    const ad = (draft.ad_creative_style ?? {}) as Record<string, unknown>;
    const onNested = (parent: 'photography_direction' | 'packaging_details' | 'ad_creative_style') =>
      (key: string, next: string) =>
        updateDraft((prev) => ({
          ...prev,
          [parent]: {
            ...((prev[parent] ?? {}) as Record<string, unknown>),
            [key]: next,
          },
        }));
    return (
      <>
        <h3 className="brand-editor__section">Photography direction</h3>
        <EditableFieldList
          rows={[
            { label: 'Lighting', key: 'lighting', value: asString(photo.lighting) },
            {
              label: 'Color grading',
              key: 'color_grading',
              value: asString(photo.color_grading),
            },
            { label: 'Composition', key: 'composition', value: asString(photo.composition) },
            {
              label: 'Subject matter',
              key: 'subject_matter',
              value: asString(photo.subject_matter),
            },
            {
              label: 'Props & surfaces',
              key: 'props_and_surfaces',
              value: asString(photo.props_and_surfaces),
            },
            { label: 'Mood', key: 'mood', value: asString(photo.mood) },
          ]}
          onChange={onNested('photography_direction')}
        />
        <h3 className="brand-editor__section">Packaging details</h3>
        <EditableFieldList
          rows={[
            {
              label: 'Physical description',
              key: 'physical_description',
              value: asString(packaging.physical_description),
              multiline: true,
            },
            {
              label: 'Label / logo placement',
              key: 'label_logo_placement',
              value: asString(packaging.label_logo_placement),
            },
            {
              label: 'Distinctive features',
              key: 'distinctive_features',
              value: asString(packaging.distinctive_features),
              multiline: true,
            },
          ]}
          onChange={onNested('packaging_details')}
        />
        <h3 className="brand-editor__section">Ad creative style</h3>
        <EditableFieldList
          rows={[
            { label: 'Typical formats', key: 'typical_formats', value: asString(ad.typical_formats) },
            {
              label: 'Text overlay style',
              key: 'text_overlay_style',
              value: asString(ad.text_overlay_style),
            },
            {
              label: 'Photo vs illustration',
              key: 'photo_vs_illustration',
              value: asString(ad.photo_vs_illustration),
            },
            { label: 'UGC usage', key: 'ugc_usage', value: asString(ad.ugc_usage) },
            { label: 'Offer presentation', key: 'offer_presentation', value: asString(ad.offer_presentation) },
          ]}
          onChange={onNested('ad_creative_style')}
        />
        <h3 className="brand-editor__section">Palette</h3>
        <EditableFieldList
          rows={[
            {
              label: 'Primary colors (comma-separated)',
              key: 'colors',
              value: asCsv(draft.colors),
            },
            {
              label: 'Background colors (comma-separated)',
              key: 'background_colors',
              value: asCsv(draft.background_colors),
            },
            { label: 'Fonts (comma-separated)', key: 'fonts', value: asCsv(draft.fonts) },
          ]}
          onChange={(key, next) =>
            updateDraft((prev) => ({ ...prev, [key]: parseCsv(next) }))
          }
        />
      </>
    );
  }
  // Read-only tabs (audience / offers / channels) — render the
  // existing flat <dl> view, with a footer hint that edits should
  // go through the brand.md file directly for now.
  return (
    <>
      {tab === 'audience' ? <ReadOnlyAudience draft={draft} /> : null}
      {tab === 'offers' ? <ReadOnlyOffers draft={draft} /> : null}
      {tab === 'channels' ? <ReadOnlyChannels draft={draft} /> : null}
      <p className="brand-editor__viewonly-hint" data-testid="brand-viewonly-hint">
        This section is view-only. Edit collection items directly in <code>brand.md</code> for
        now; richer add/remove UI is on the roadmap.
      </p>
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Read-only renderers for the deferred tabs.
// ──────────────────────────────────────────────────────────

function ReadOnlyAudience({ draft }: { draft: BrandProfile }): JSX.Element {
  const audiences = Array.isArray(draft.audiences) ? draft.audiences : [];
  const personas = Array.isArray(draft.personas) ? draft.personas : [];
  return (
    <>
      <h3 className="brand-editor__section">Target audience</h3>
      <FieldList
        rows={[
          ['Summary', asString(draft.target_audience)],
          ['Key benefits', asCsv(draft.key_benefits)],
          ['USPs', asCsv(draft.usps)],
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

function ReadOnlyOffers({ draft }: { draft: BrandProfile }): JSX.Element {
  const offers = Array.isArray(draft.offers) ? draft.offers : [];
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
          ['Proof points', asCsv(draft.proof_points)],
          ['Guarantee', asString(draft.guarantee)],
          ['Competitive differentiation', asString(draft.competitive_differentiation)],
        ]}
      />
    </>
  );
}

function ReadOnlyChannels({ draft }: { draft: BrandProfile }): JSX.Element {
  const channels = (draft.channels ?? {}) as Record<string, unknown>;
  const pillars = Array.isArray(draft.pillars) ? draft.pillars : [];
  const formats = Array.isArray(draft.formats) ? draft.formats : [];
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
                  <p>Signals: {asCsv(row.signals)}</p>
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

// ──────────────────────────────────────────────────────────
// Editable field helpers.
// ──────────────────────────────────────────────────────────

interface FieldRow {
  label: string;
  key: string;
  value: string;
  multiline?: boolean;
  readOnly?: boolean;
}

function EditableFieldList({
  rows,
  onChange,
}: {
  rows: FieldRow[];
  onChange: (key: string, next: string) => void;
}): JSX.Element {
  return (
    <dl className="brand-editor__fields">
      {rows.map((row) => (
        <div key={row.key} className="brand-editor__row">
          <dt>
            <label htmlFor={`brand-field-${row.key}`}>{row.label}</label>
          </dt>
          <dd>
            {row.readOnly ? (
              <span data-testid={`brand-field-${row.key}-readonly`}>{row.value || '—'}</span>
            ) : row.multiline ? (
              <textarea
                id={`brand-field-${row.key}`}
                data-testid={`brand-field-${row.key}`}
                value={row.value}
                rows={3}
                onChange={(e) => onChange(row.key, e.target.value)}
              />
            ) : (
              <input
                id={`brand-field-${row.key}`}
                data-testid={`brand-field-${row.key}`}
                type="text"
                value={row.value}
                onChange={(e) => onChange(row.key, e.target.value)}
              />
            )}
          </dd>
        </div>
      ))}
    </dl>
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

// ──────────────────────────────────────────────────────────
// Coercion helpers — keep brand-loader's permissive shape
// compatible with React's controlled-input requirement that
// every value is a string.
// ──────────────────────────────────────────────────────────

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asCsv(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter((v) => typeof v === 'string' && v.length > 0).join(', ');
}

function asLines(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter((v) => typeof v === 'string').join('\n');
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Structural equality — used for dirty tracking. We deliberately
// don't import lodash for one consumer; this hand-rolled walker is
// stable for JSON-safe values (the only shape brand.md frontmatter
// can take).
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (
        !deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}
