// Serializer tests — the inverse direction of loadBrandProfileFromText.
//
// The key invariant: a profile that loaded cleanly serializes back to
// text whose re-parse equals the original. We don't assert byte-for-
// byte equality with hand-authored brand.md (key ordering, quoting
// style, and trailing whitespace all change), only structural equality.

import { describe, it, expect } from 'vitest'
import {
  BrandLoaderError,
  loadBrandProfileFromText,
  parseFrontmatter,
  serializeBrandProfile,
} from '../src/loader.js'
import type { BrandProfile } from '../src/types.js'

const SAMPLE: BrandProfile = {
  id: 'givecare',
  name: 'GiveCare',
  positioning: 'caregiver support',
  url: 'https://givecare.example',
  voice: {
    tone: 'warm',
    style: 'plainspoken',
    do: ['be direct', 'cite data'],
    dont: ['use jargon'],
  },
  voice_adjectives: ['warm', 'direct'],
  photography_direction: {
    lighting: 'soft daylight',
    mood: 'hopeful',
    composition: 'rule of thirds',
  },
  audiences: [{ id: 'family-caregivers', summary: 'Adult children of aging parents' }],
  offers: [
    {
      id: 'pulse',
      summary: 'Daily caregiver pulse',
      url: 'https://pulse.example',
      cta: 'Sign up',
    },
  ],
  pillars: [
    {
      id: 'care-economy',
      perspective: 'systemic',
      signals: ['policy', 'reform'],
    },
  ],
}

describe('serializeBrandProfile', () => {
  it('rejects a profile missing required fields', () => {
    expect(() => serializeBrandProfile({ id: 'x' } as unknown as BrandProfile)).toThrow(
      BrandLoaderError,
    )
    expect(() => serializeBrandProfile({ name: 'X' } as unknown as BrandProfile)).toThrow(
      BrandLoaderError,
    )
    expect(() => serializeBrandProfile(null as unknown as BrandProfile)).toThrow(BrandLoaderError)
  })

  it('emits a frontmatter block delimited by --- lines', () => {
    const out = serializeBrandProfile(SAMPLE)
    expect(out.startsWith('---\n')).toBe(true)
    // exactly two `---` lines (open + close).
    const matches = out.match(/^---\s*$/gm)
    expect(matches?.length).toBe(2)
  })

  it('round-trips through loadBrandProfileFromText (deep equal)', () => {
    const text = serializeBrandProfile(SAMPLE)
    const reparsed = loadBrandProfileFromText(text)
    expect(reparsed).toEqual(SAMPLE)
  })

  it('preserves the markdown body when one is provided', () => {
    const body = '\nThis brand fights for unpaid caregivers.\n'
    const text = serializeBrandProfile(SAMPLE, { body })
    expect(text).toContain('This brand fights for unpaid caregivers.')
    const { body: roundTripBody } = parseFrontmatter(text)
    expect(roundTripBody).toBe('This brand fights for unpaid caregivers.\n')
  })

  it('keeps long scalar fields on one line (no auto-wrap)', () => {
    const long = 'a'.repeat(300)
    const out = serializeBrandProfile({ ...SAMPLE, positioning: long })
    expect(out).toContain(long)
  })

  it('does not emit YAML anchors / aliases for repeated nested objects', () => {
    const shared = { lighting: 'soft daylight' }
    const out = serializeBrandProfile({
      ...SAMPLE,
      photography_direction: shared,
      packaging_details: shared as unknown as Record<string, unknown>,
    })
    // js-yaml's noRefs prevents `&anchor` / `*alias` output.
    expect(out).not.toMatch(/&\w/)
    expect(out).not.toMatch(/\*\w/)
  })
})
