import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadLegacyBrandJson, migrateLegacyBrandJson } from '../src/legacy.js'
import { loadBrandProfile } from '../src/loader.js'
import { BrandLoaderError } from '../src/loader.js'

const sampleLegacy = {
  brandDna: {
    name: 'Round Trip Brand',
    url: 'https://rt.example',
    brandSummary: 'A migrated brand.',
    colors: ['#111', '#222'],
    voiceAdjectives: ['Direct'],
    photographyDirection: { lighting: 'Soft.', colorGrading: 'Warm.' },
    packagingDetails: { physicalDescription: 'Box.' },
  },
  personas: [
    {
      id: 'p1',
      name: 'Alex',
      painPoints: ['expensive'],
      motivations: ['clarity'],
    },
  ],
}

describe('loadLegacyBrandJson', () => {
  it('maps camelCase mh2 fields to canonical snake_case', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-legacy-'))
    try {
      const src = join(root, 'brand.json')
      writeFileSync(src, JSON.stringify(sampleLegacy))

      const profile = loadLegacyBrandJson(src)
      expect(profile.id).toBe('round-trip-brand')
      expect(profile.name).toBe('Round Trip Brand')
      expect(profile.brand_summary).toBe('A migrated brand.')
      expect(profile.voice_adjectives).toEqual(['Direct'])
      expect(profile.photography_direction).toEqual({
        lighting: 'Soft.',
        color_grading: 'Warm.',
      })
      expect(profile.packaging_details).toEqual({ physical_description: 'Box.' })
      expect(profile.personas).toEqual([
        { id: 'p1', name: 'Alex', pain_points: ['expensive'], motivations: ['clarity'] },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects missing brandDna', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-legacy-bad-'))
    try {
      const src = join(root, 'brand.json')
      writeFileSync(src, JSON.stringify({ personas: [] }))
      expect(() => loadLegacyBrandJson(src)).toThrow(BrandLoaderError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects missing name', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-legacy-noname-'))
    try {
      const src = join(root, 'brand.json')
      writeFileSync(src, JSON.stringify({ brandDna: {} }))
      expect(() => loadLegacyBrandJson(src)).toThrow(BrandLoaderError)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('honors a caller-provided brandId', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-legacy-id-'))
    try {
      const src = join(root, 'brand.json')
      writeFileSync(src, JSON.stringify(sampleLegacy))
      const profile = loadLegacyBrandJson(src, 'custom-id')
      expect(profile.id).toBe('custom-id')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('migrateLegacyBrandJson', () => {
  it('writes a canonical brand.md that round-trips back to the same shape', () => {
    const root = mkdtempSync(join(tmpdir(), 'mh-legacy-migrate-'))
    try {
      const src = join(root, 'brand.json')
      writeFileSync(src, JSON.stringify(sampleLegacy))

      const out = migrateLegacyBrandJson(src, join(root, 'migrated'))
      expect(existsSync(out)).toBe(true)

      const reloaded = loadBrandProfile(join(root, 'migrated'))
      expect(reloaded.id).toBe('round-trip-brand')
      expect(reloaded.brand_summary).toBe('A migrated brand.')
      expect(reloaded.photography_direction).toEqual({
        lighting: 'Soft.',
        color_grading: 'Warm.',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
