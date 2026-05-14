// MODIFIED 2026-05-13 by mh-creative-os fork:
// Added 'brand' Route kind (Phase E3.3.b) and 'runs' Route kind
// (Phase E3.3.d) so /brands/:id and /runs are deep-linkable.
// parseRoute / buildPath learn the new shapes; navigate() is
// unchanged.
// Upstream: nexu-io/open-design @ 7c8305f4

// Tiny URL router. We avoid pulling in react-router for two reasons:
// the surface area we need is small (a handful of routes, plain
// pushState), and we want a single source of truth for "what file is
// open" — encoding that in the URL is the simplest way to make it
// deep-linkable.

import { useEffect, useState } from 'react';

export type Route =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string; fileName: string | null }
  | { kind: 'brand'; brandId: string }
  | { kind: 'runs' };

export function parseRoute(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'projects' && parts[1]) {
    const projectId = decodeURIComponent(parts[1]);
    if (parts[2] === 'files' && parts[3]) {
      return {
        kind: 'project',
        projectId,
        fileName: decodeURIComponent(parts.slice(3).join('/')),
      };
    }
    return { kind: 'project', projectId, fileName: null };
  }
  if (parts[0] === 'brands' && parts[1]) {
    return { kind: 'brand', brandId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'runs') {
    return { kind: 'runs' };
  }
  return { kind: 'home' };
}

export function buildPath(route: Route): string {
  if (route.kind === 'home') return '/';
  if (route.kind === 'runs') return '/runs';
  if (route.kind === 'brand') return `/brands/${encodeURIComponent(route.brandId)}`;
  const id = encodeURIComponent(route.projectId);
  if (route.fileName) {
    const file = route.fileName
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    return `/projects/${id}/files/${file}`;
  }
  return `/projects/${id}`;
}

// Centralized navigation. Components call this instead of mutating
// `window.location` directly so we can fan the change out to any
// `useRoute()` subscriber via a custom event.
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const target = buildPath(route);
  const current = window.location.pathname;
  if (target === current) return;
  if (opts.replace) {
    window.history.replaceState(null, '', target);
  } else {
    window.history.pushState(null, '', target);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}
