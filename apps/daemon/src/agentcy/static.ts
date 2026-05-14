// Safe filesystem serving for engine artifacts.
//
// Engine workflows write outputs to apps/engine/state/artifacts/<runId>/...
// The daemon never opens the engine's SQLite, but it does need to surface
// those files to HTTP clients (web UI rendering an ad PNG, curl smoke-test).
// This module owns the read path with strict guards:
//
//   1. The composed absolute path must remain inside artifactsDir.
//   2. Symlinks anywhere on the resolved path are rejected.
//   3. Filenames with `..` or null bytes are rejected before fs.realpath.
//
// Anything not satisfying all three returns 404; we never disclose
// whether a file would have existed outside the safe root.

import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

export class UnsafeArtifactPath extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeArtifactPath'
  }
}

export interface ResolvedArtifact {
  /** Absolute, real (symlink-free) path. Safe to fs.createReadStream on. */
  realPath: string
  /** Size in bytes. */
  size: number
}

export function resolveArtifactPath(
  artifactsDir: string,
  runId: string,
  relpath: string,
): ResolvedArtifact {
  if (!runId || runId.includes('..') || runId.includes(sep) || runId.includes('\0')) {
    throw new UnsafeArtifactPath('invalid runId')
  }
  if (!relpath || relpath.includes('\0')) {
    throw new UnsafeArtifactPath('invalid relpath')
  }
  // Reject leading-slash, parent-dir, and any normalize() escape attempt.
  if (isAbsolute(relpath)) throw new UnsafeArtifactPath('relpath must not be absolute')
  const normalized = normalize(relpath)
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`)) {
    throw new UnsafeArtifactPath('relpath escapes run directory')
  }

  const composed = resolve(join(artifactsDir, runId, normalized))
  let realArtifacts: string
  let realComposed: string
  try {
    realArtifacts = realpathSync(artifactsDir)
    realComposed = realpathSync(composed)
  } catch {
    throw new UnsafeArtifactPath('file not found')
  }

  // Ensure realComposed is strictly under realArtifacts (defend against
  // symlinks within the run directory that point outside).
  const withSep = realArtifacts.endsWith(sep) ? realArtifacts : realArtifacts + sep
  if (!realComposed.startsWith(withSep)) {
    throw new UnsafeArtifactPath('resolved path escapes artifacts root')
  }

  const stats = statSync(realComposed)
  if (!stats.isFile()) {
    throw new UnsafeArtifactPath('not a regular file')
  }

  return { realPath: realComposed, size: stats.size }
}

/** Cheap content-type from extension; covers the few types engine workflows
 *  currently produce. Falls back to application/octet-stream.
 */
export function contentTypeFor(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain'
  return 'application/octet-stream'
}
