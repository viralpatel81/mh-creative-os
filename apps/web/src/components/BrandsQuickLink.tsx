// Quick-link strip that surfaces available brands from the daemon
// (`GET /api/agentcy/brands`). Hidden when no brands are returned so
// it stays invisible to operators who haven't seeded a brand yet.
// Each chip deep-links to /brands/:id (the read-only BrandEditor,
// Phase E3.3.b).
//
// This is a NEW file — no Apache change-notice needed.

import { useEffect, useState } from 'react';

import { navigate } from '../router';

interface BrandSummary {
  id: string;
  name: string;
}

interface ListResponse {
  brands?: BrandSummary[];
}

export interface BrandsQuickLinkProps {
  /** Test seam — defaults to window.fetch. */
  fetcher?: typeof fetch;
}

export function BrandsQuickLink({ fetcher }: BrandsQuickLinkProps): JSX.Element | null {
  const fx = fetcher ?? fetch;
  const [brands, setBrands] = useState<BrandSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fx('/api/agentcy/brands');
        if (!res.ok) {
          if (!cancelled) setBrands([]);
          return;
        }
        const body = (await res.json()) as ListResponse;
        if (cancelled) return;
        const list = Array.isArray(body.brands)
          ? body.brands.filter((b): b is BrandSummary => !!b && typeof b.id === 'string')
          : [];
        setBrands(list);
      } catch {
        if (!cancelled) setBrands([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fx]);

  if (brands === null || brands.length === 0) return null;

  return (
    <div className="brands-quick-link" data-testid="brands-quick-link">
      <span className="brands-quick-link__label">Brands:</span>
      {brands.map((b) => (
        <button
          key={b.id}
          type="button"
          className="brands-quick-link__chip"
          data-testid={`brand-chip-${b.id}`}
          onClick={() => navigate({ kind: 'brand', brandId: b.id })}
        >
          {b.name || b.id}
        </button>
      ))}
    </div>
  );
}
