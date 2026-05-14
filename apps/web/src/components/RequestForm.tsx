// RequestForm (Phase E3.3.f).
//
// Renders the per-workflow input form at /runs/new/:workflow. Field
// shapes follow packages/protocols/schemas/{ad,email,popup}_request.v1.
// Submit posts to /api/agentcy/runs/workflow, then navigates to the
// detail view at /runs/:runId.
//
// New file — no Apache change-notice needed.

import { useEffect, useState } from 'react';

import { navigate, NATIVE_WORKFLOWS, type WorkflowName } from '../router';

function isNative(workflow: WorkflowName): boolean {
  return (NATIVE_WORKFLOWS as readonly string[]).includes(workflow);
}

const AD_ASPECTS = ['1:1', '3:4', '9:16'] as const;
const EMAIL_ASPECTS = ['2:3', '3:4', '9:16'] as const;
const POPUP_ASPECTS = ['1:1', '4:5', '3:4'] as const;

const EMAIL_PURPOSES = [
  'welcome',
  'abandoned-cart',
  'win-back',
  'promo',
  'retention',
  'announcement',
  'transactional',
  'custom',
] as const;

const POPUP_PURPOSES = [
  'email-capture',
  'discount-offer',
  'free-shipping',
  'spin-to-win',
  'exit-intent',
  'announcement',
  'preference-quiz',
  'cart-recovery',
  'custom',
] as const;

const ENGINES = ['gemini', 'openai'] as const;

interface BrandSummary {
  id: string;
  name: string;
}

interface FormState {
  brandId: string;
  brief: string;
  customDescription: string;
  purpose: string;
  engine: 'gemini' | 'openai';
  layoutMode: 'strategy' | 'template';
  aspects: string[];
  quantity: number;
  // Native-agentcy fields (social.post / blog.post / outreach.touch
  // / respond.reply). The engine CLI is permissive about which params
  // each workflow uses, so we always send all three and let the
  // pipeline pick what it needs.
  topic: string;
  pillar: string;
  format: string;
}

function initialState(workflow: WorkflowName, prefilledBrand: string | null): FormState {
  return {
    brandId: prefilledBrand ?? '',
    brief: '',
    customDescription: '',
    purpose:
      workflow === 'email.design'
        ? 'welcome'
        : workflow === 'popup.design'
          ? 'email-capture'
          : '',
    engine: 'gemini',
    layoutMode: 'strategy',
    aspects:
      workflow === 'ad.post'
        ? ['1:1']
        : workflow === 'email.design'
          ? ['3:4']
          : workflow === 'popup.design'
            ? ['1:1']
            : [], // native workflows don't use aspects
    quantity: 1,
    topic: '',
    pillar: '',
    format: '',
  };
}

export interface RequestFormProps {
  workflow: WorkflowName;
  prefilledBrandId: string | null;
  /** Test seam — defaults to window.fetch. */
  fetcher?: typeof fetch;
}

export function RequestForm({
  workflow,
  prefilledBrandId,
  fetcher,
}: RequestFormProps): JSX.Element {
  const fx = fetcher ?? fetch;
  const [brands, setBrands] = useState<BrandSummary[] | null>(null);
  const [form, setForm] = useState<FormState>(() => initialState(workflow, prefilledBrandId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fx('/api/agentcy/brands');
        if (cancelled) return;
        if (!res.ok) {
          setBrands([]);
          return;
        }
        const body = (await res.json()) as { brands?: BrandSummary[] };
        setBrands(Array.isArray(body.brands) ? body.brands : []);
      } catch {
        if (!cancelled) setBrands([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fx]);

  const aspectOptions =
    workflow === 'ad.post'
      ? AD_ASPECTS
      : workflow === 'email.design'
        ? EMAIL_ASPECTS
        : POPUP_ASPECTS;

  const purposeOptions =
    workflow === 'email.design'
      ? EMAIL_PURPOSES
      : workflow === 'popup.design'
        ? POPUP_PURPOSES
        : null;

  const toggleAspect = (aspect: string) => {
    setForm((prev) => {
      const next = prev.aspects.includes(aspect)
        ? prev.aspects.filter((a) => a !== aspect)
        : [...prev.aspects, aspect];
      return { ...prev, aspects: next };
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.brandId) {
      setError('Pick a brand');
      return;
    }
    const native = isNative(workflow);
    if (!native && form.aspects.length === 0) {
      setError('Pick at least one aspect');
      return;
    }
    setSubmitting(true);
    setError(null);
    let params: Record<string, unknown>;
    if (native) {
      params = {};
      if (form.topic) params.topic = form.topic;
      if (form.pillar) params.pillar = form.pillar;
      if (form.format) params.format = form.format;
      if (form.brief) params.brief_text = form.brief;
    } else {
      params = {
        aspects: form.aspects,
        engine: form.engine,
        quantity: form.quantity,
      };
      if (form.brief) params.brief_text = form.brief;
      if (form.customDescription) params.custom_description = form.customDescription;
      if (workflow === 'ad.post') {
        params.layout_mode = form.layoutMode;
      }
      if (workflow !== 'ad.post') {
        params.purpose = form.purpose;
      }
    }
    try {
      const res = await fx('/api/agentcy/runs/workflow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workflow,
          brand_id: form.brandId,
          params,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      const body = (await res.json()) as { runId: string };
      navigate({ kind: 'run', runId: body.runId });
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="request-form" data-testid="request-form">
      <header className="request-form__header">
        <button
          type="button"
          className="request-form__back"
          onClick={() => navigate({ kind: 'runs' })}
        >
          ← Runs
        </button>
        <h1 className="request-form__title">New {workflow} run</h1>
      </header>

      <form onSubmit={onSubmit} className="request-form__form">
        <div className="request-form__row">
          <label htmlFor="rf-brand">Brand</label>
          {brands === null ? (
            <span>Loading brands…</span>
          ) : brands.length === 0 ? (
            <input
              id="rf-brand"
              data-testid="rf-brand"
              type="text"
              value={form.brandId}
              placeholder="brand id"
              onChange={(e) => setForm((p) => ({ ...p, brandId: e.target.value }))}
            />
          ) : (
            <select
              id="rf-brand"
              data-testid="rf-brand"
              value={form.brandId}
              onChange={(e) => setForm((p) => ({ ...p, brandId: e.target.value }))}
            >
              <option value="">— pick a brand —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || b.id}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="request-form__row">
          <label htmlFor="rf-brief">Brief</label>
          <textarea
            id="rf-brief"
            data-testid="rf-brief"
            value={form.brief}
            rows={3}
            onChange={(e) => setForm((p) => ({ ...p, brief: e.target.value }))}
            placeholder="What's the angle / topic / hook?"
          />
        </div>

        {isNative(workflow) ? (
          <>
            <div className="request-form__row">
              <label htmlFor="rf-topic">Topic</label>
              <input
                id="rf-topic"
                data-testid="rf-topic"
                type="text"
                value={form.topic}
                placeholder="What's this about?"
                onChange={(e) => setForm((p) => ({ ...p, topic: e.target.value }))}
              />
            </div>
            <div className="request-form__row">
              <label htmlFor="rf-pillar">Pillar (optional)</label>
              <input
                id="rf-pillar"
                data-testid="rf-pillar"
                type="text"
                value={form.pillar}
                placeholder="e.g. care-economy"
                onChange={(e) => setForm((p) => ({ ...p, pillar: e.target.value }))}
              />
            </div>
            <div className="request-form__row">
              <label htmlFor="rf-format">Format (optional)</label>
              <input
                id="rf-format"
                data-testid="rf-format"
                type="text"
                value={form.format}
                placeholder="e.g. infographic, statement, stat"
                onChange={(e) => setForm((p) => ({ ...p, format: e.target.value }))}
              />
            </div>
          </>
        ) : null}

        {!isNative(workflow) && purposeOptions ? (
          <div className="request-form__row">
            <label htmlFor="rf-purpose">Purpose</label>
            <select
              id="rf-purpose"
              data-testid="rf-purpose"
              value={form.purpose}
              onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))}
            >
              {purposeOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {workflow === 'ad.post' ? (
          <div className="request-form__row">
            <label>Layout mode</label>
            <div className="request-form__chips">
              {(['strategy', 'template'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={
                    form.layoutMode === mode
                      ? 'request-form__chip request-form__chip--active'
                      : 'request-form__chip'
                  }
                  data-testid={`rf-layout-${mode}`}
                  onClick={() => setForm((p) => ({ ...p, layoutMode: mode }))}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!isNative(workflow) ? (
          <>
            <div className="request-form__row">
              <label>Aspects</label>
              <div className="request-form__chips">
                {aspectOptions.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={
                      form.aspects.includes(a)
                        ? 'request-form__chip request-form__chip--active'
                        : 'request-form__chip'
                    }
                    data-testid={`rf-aspect-${a}`}
                    onClick={() => toggleAspect(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="request-form__row">
              <label>Engine</label>
              <div className="request-form__chips">
                {ENGINES.map((eng) => (
                  <button
                    key={eng}
                    type="button"
                    className={
                      form.engine === eng
                        ? 'request-form__chip request-form__chip--active'
                        : 'request-form__chip'
                    }
                    data-testid={`rf-engine-${eng}`}
                    onClick={() => setForm((p) => ({ ...p, engine: eng }))}
                  >
                    {eng}
                  </button>
                ))}
              </div>
            </div>

            <div className="request-form__row">
              <label htmlFor="rf-quantity">Quantity</label>
              <input
                id="rf-quantity"
                data-testid="rf-quantity"
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => setForm((p) => ({ ...p, quantity: Math.max(1, Number(e.target.value) || 1) }))}
              />
            </div>
          </>
        ) : null}

        {error ? (
          <p className="request-form__error" data-testid="rf-error">
            {error}
          </p>
        ) : null}

        <div className="request-form__submit-row">
          <button
            type="submit"
            data-testid="rf-submit"
            disabled={submitting || !form.brandId}
          >
            {submitting ? 'Launching…' : `Launch ${workflow}`}
          </button>
        </div>
      </form>
    </div>
  );
}
