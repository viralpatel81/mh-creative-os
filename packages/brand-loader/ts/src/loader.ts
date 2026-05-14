import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

import type { BrandProfile } from './types.js'

export class BrandLoaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrandLoaderError'
  }
}

// Same regex semantics as the Python loader: opening `---`, body, closing
// `---`, each on its own line, with optional trailing whitespace.
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/

export function parseFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) {
    return { frontmatter: {}, body: text }
  }
  const raw = match[1] ?? ''
  const body = match[2] ?? ''
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    throw new BrandLoaderError(`invalid YAML frontmatter: ${(err as Error).message}`)
  }
  if (parsed == null) {
    return { frontmatter: {}, body }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BrandLoaderError('brand.md frontmatter must be a YAML mapping')
  }
  return { frontmatter: parsed as Record<string, unknown>, body }
}

export function loadBrandProfileFromText(text: string): BrandProfile {
  const { frontmatter } = parseFrontmatter(text)
  if (!('id' in frontmatter)) {
    throw new BrandLoaderError('brand profile missing required field: id')
  }
  if (!('name' in frontmatter)) {
    throw new BrandLoaderError('brand profile missing required field: name')
  }
  return normalize(frontmatter)
}

export function loadBrandProfile(brandDir: string): BrandProfile {
  const path = join(brandDir, 'brand.md')
  if (!existsSync(path)) {
    throw new BrandLoaderError(`brand.md not found at ${path}`)
  }
  return loadBrandProfileFromText(readFileSync(path, 'utf8'))
}

function normalize(raw: Record<string, unknown>): BrandProfile {
  // Pass through as-is. The YAML loader preserves key order via insertion
  // semantics; any future shape coercion (e.g., trimming strings) lands
  // here so Python + TS stay in lockstep.
  return raw as BrandProfile
}

export interface SerializeBrandProfileOptions {
  /**
   * Body text preserved after the closing `---` frontmatter delimiter.
   * Callers that want to keep the markdown body around across a save
   * cycle should pass parseFrontmatter(originalText).body here.
   */
  body?: string
}

/**
 * Serialize a BrandProfile back to its on-disk brand.md form. Inverse
 * of loadBrandProfileFromText. We re-emit the YAML frontmatter via
 * js-yaml with a generous lineWidth so long string fields (e.g.
 * positioning, brand_summary) stay on a single line rather than
 * getting folded into multi-line scalars.
 *
 * Round-trip invariant (covered by tests): for any profile P that
 * loaded cleanly,
 *   loadBrandProfileFromText(serializeBrandProfile(P)) deep-equals P
 * after key normalization.
 */
export function serializeBrandProfile(
  profile: BrandProfile,
  opts: SerializeBrandProfileOptions = {},
): string {
  if (!profile || typeof profile !== 'object') {
    throw new BrandLoaderError('serializeBrandProfile: profile must be an object')
  }
  if (typeof profile.id !== 'string' || !profile.id) {
    throw new BrandLoaderError('serializeBrandProfile: profile.id is required')
  }
  if (typeof profile.name !== 'string' || !profile.name) {
    throw new BrandLoaderError('serializeBrandProfile: profile.name is required')
  }
  const dumped = yaml.dump(profile, {
    lineWidth: 1000,
    noRefs: true,
    sortKeys: false,
    skipInvalid: false,
  })
  const body = opts.body ?? ''
  const frontmatter = dumped.endsWith('\n') ? dumped.slice(0, -1) : dumped
  // Match the layout produced by typical hand-authored brand.md: a
  // blank line between the closing --- and the body when a body is
  // present, just a trailing newline when it isn't.
  if (body.length === 0) return `---\n${frontmatter}\n---\n`
  const bodyNormalized = body.startsWith('\n') ? body : `\n${body}`
  const trailing = bodyNormalized.endsWith('\n') ? '' : '\n'
  return `---\n${frontmatter}\n---${bodyNormalized}${trailing}`
}
