import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { BrandLoaderError } from './loader.js'
import type { BrandProfile } from './types.js'

// Field maps mirror the Python `legacy.py` exactly. Kept duplicated rather
// than read from a shared JSON because both implementations need to
// hardcode the mapping for type safety; parity tests verify they agree.
const FIELD_MAP: Record<string, string> = {
  name: 'name',
  url: 'url',
  description: 'description',
  category: 'category',
  brandSummary: 'brand_summary',
  colors: 'colors',
  fonts: 'fonts',
  voiceTone: 'voice_tone_legacy',
  voiceAdjectives: 'voice_adjectives',
  targetAudience: 'target_audience',
  keyBenefits: 'key_benefits',
  usps: 'usps',
  featuresAndBenefits: 'features_and_benefits',
  brandGuidelinesAnalysis: 'brand_guidelines_analysis',
  photographyDirection: 'photography_direction',
  packagingDetails: 'packaging_details',
  adCreativeStyle: 'ad_creative_style',
  promptModifier: 'prompt_modifier',
  backgroundColors: 'background_colors',
  ctaStyle: 'cta_style',
  competitiveDifferentiation: 'competitive_differentiation',
  guarantee: 'guarantee',
  productType: 'product_type',
  socialProof: 'social_proof',
}

const NESTED_FIELD_MAP: Record<string, Record<string, string>> = {
  photography_direction: {
    lighting: 'lighting',
    colorGrading: 'color_grading',
    composition: 'composition',
    subjectMatter: 'subject_matter',
    propsAndSurfaces: 'props_and_surfaces',
    mood: 'mood',
  },
  packaging_details: {
    physicalDescription: 'physical_description',
    labelLogoPlacement: 'label_logo_placement',
    distinctiveFeatures: 'distinctive_features',
  },
  ad_creative_style: {
    typicalFormats: 'typical_formats',
    textOverlayStyle: 'text_overlay_style',
    photoVsIllustration: 'photo_vs_illustration',
    ugcUsage: 'ugc_usage',
    offerPresentation: 'offer_presentation',
  },
}

const PERSONA_FIELDS: Record<string, string> = {
  id: 'id',
  name: 'name',
  age: 'age',
  description: 'description',
  painPoints: 'pain_points',
  motivations: 'motivations',
}

function slugify(name: string): string {
  const slug = name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug || 'brand'
}

export function loadLegacyBrandJson(
  path: string,
  brandId?: string,
): BrandProfile {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new BrandLoaderError(`invalid brand.json: ${(err as Error).message}`)
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BrandLoaderError('brand.json must be a JSON object')
  }

  const data = parsed as Record<string, unknown>
  const dna = data.brandDna
  if (dna == null || typeof dna !== 'object' || Array.isArray(dna)) {
    throw new BrandLoaderError('brand.json missing top-level `brandDna` object')
  }
  const dnaObj = dna as Record<string, unknown>
  const name = dnaObj.name
  if (typeof name !== 'string' || name.trim() === '') {
    throw new BrandLoaderError('brand.json brandDna.name must be a non-empty string')
  }

  const result: Record<string, unknown> = {
    id: brandId ?? slugify(name),
    name,
  }

  for (const [legacyKey, canonicalKey] of Object.entries(FIELD_MAP)) {
    if (!(legacyKey in dnaObj)) continue
    const value = dnaObj[legacyKey]
    const nestedMap = NESTED_FIELD_MAP[canonicalKey]
    if (nestedMap && value != null && typeof value === 'object' && !Array.isArray(value)) {
      const valueObj = value as Record<string, unknown>
      const renamed: Record<string, unknown> = {}
      for (const [innerLegacy, innerCanonical] of Object.entries(nestedMap)) {
        if (innerLegacy in valueObj) {
          renamed[innerCanonical] = valueObj[innerLegacy]
        }
      }
      result[canonicalKey] = renamed
    } else {
      result[canonicalKey] = value
    }
  }

  const personasRaw = data.personas
  if (Array.isArray(personasRaw)) {
    const personas: Array<Record<string, unknown>> = []
    for (const p of personasRaw) {
      if (p == null || typeof p !== 'object' || Array.isArray(p)) continue
      const pObj = p as Record<string, unknown>
      const mapped: Record<string, unknown> = {}
      for (const [legacyKey, canonicalKey] of Object.entries(PERSONA_FIELDS)) {
        if (legacyKey in pObj) {
          mapped[canonicalKey] = pObj[legacyKey]
        }
      }
      if ('id' in mapped) personas.push(mapped)
    }
    if (personas.length > 0) result.personas = personas
  }

  return result as BrandProfile
}

export function migrateLegacyBrandJson(
  source: string,
  targetDir: string,
  brandId?: string,
): string {
  const profile = loadLegacyBrandJson(source, brandId)
  mkdirSync(targetDir, { recursive: true })
  const out = join(targetDir, 'brand.md')
  const body = yaml.dump(profile, { noRefs: true, lineWidth: -1 })
  writeFileSync(out, `---\n${body}---\n`, 'utf8')
  return out
}
