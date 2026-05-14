// Resolve an artifact `src` attribute into a URL the browser can load.
//
// The engine emits image artifacts with paths that are filesystem-
// relative to the engine root, e.g.
//
//   <artifact type="image/png" src="state/artifacts/run_<id>/ad.png" />
//
// The daemon's static-artifact route serves the same bytes at
//
//   /api/agentcy/artifacts/<runId>/<rel>
//
// In dev and in packaged builds the web layer proxies /api/* to the
// daemon, so a bare relative path works without any base-URL handling.
// What this module owns is *normalizing* the engine's varied src
// shapes into that relative URL.
//
// Accepted shapes:
//   - "state/artifacts/<runId>/<rel>"       → "/api/agentcy/artifacts/<runId>/<rel>"
//   - "/api/agentcy/artifacts/<runId>/..."  → passed through
//   - "data:image/png;base64,..."           → passed through
//   - absolute http(s) URL                  → passed through
//   - any unrecognized form                 → null (caller chooses fallback UX)

const STATE_ARTIFACTS_PREFIX = 'state/artifacts/'
const DAEMON_ARTIFACT_PREFIX = '/api/agentcy/artifacts/'

export interface ResolveImageSrcOptions {
  /**
   * Optional run id used as a fallback when the src is a bare
   * filename without a run prefix.
   */
  runId?: string
}

export function resolveImageSrc(rawSrc: string, opts: ResolveImageSrcOptions = {}): string | null {
  if (!rawSrc) return null
  const src = rawSrc.trim()
  if (!src) return null

  // Passthrough: absolute URLs or data URIs.
  if (/^(?:https?:|data:|blob:)/i.test(src)) return src

  // Already daemon-shaped (with or without leading slash).
  if (src.startsWith(DAEMON_ARTIFACT_PREFIX)) return src
  if (src.startsWith(DAEMON_ARTIFACT_PREFIX.slice(1))) return `/${src}`

  // Engine filesystem shape — anchor to the daemon route.
  if (src.startsWith(STATE_ARTIFACTS_PREFIX)) {
    const tail = src.slice(STATE_ARTIFACTS_PREFIX.length)
    if (!tail) return null
    return `${DAEMON_ARTIFACT_PREFIX}${tail}`
  }

  // Bare filename + a runId in context → assemble.
  if (opts.runId && !src.startsWith('/') && !src.includes('..')) {
    return `${DAEMON_ARTIFACT_PREFIX}${opts.runId}/${src}`
  }

  return null
}
