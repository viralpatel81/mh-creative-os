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
