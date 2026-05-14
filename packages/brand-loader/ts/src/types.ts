// Mirror of schema/brand_profile.v2.json — see that file for the
// authoritative shape. Both languages keep their type definitions in
// lockstep; parity tests catch drift between Python output and TS output
// against the same fixture.

export interface AudienceRef {
  id: string
  summary: string
}

export interface Offer {
  id: string
  summary: string
  url?: string
  cta?: string
}

export interface Pillar {
  id: string
  perspective?: string
  signals?: string[]
  format?: string
  frequency?: string
  default_format?: string
}

export interface VoiceRules {
  tone?: string
  style?: string
  do?: string[]
  dont?: string[]
}

export interface Format {
  id: string
  description?: string
}

export interface PhotographyDirection {
  lighting?: string
  color_grading?: string
  composition?: string
  subject_matter?: string
  props_and_surfaces?: string
  mood?: string
}

export interface PackagingDetails {
  physical_description?: string
  label_logo_placement?: string
  distinctive_features?: string
}

export interface AdCreativeStyle {
  typical_formats?: string
  text_overlay_style?: string
  photo_vs_illustration?: string
  ugc_usage?: string
  offer_presentation?: string
}

export interface Persona {
  id: string
  name?: string
  age?: string
  description?: string
  pain_points?: string[]
  motivations?: string[]
}

export interface BrandProfile {
  id: string
  name: string

  // agentcy fields
  positioning?: string
  audiences?: AudienceRef[]
  offers?: Offer[]
  proof_points?: string[]
  pillars?: Pillar[]
  voice?: VoiceRules
  channels?: Record<string, unknown>
  formats?: Format[]

  // mh2 extensions
  url?: string
  description?: string
  category?: string
  brand_summary?: string
  colors?: string[]
  fonts?: string[]
  voice_adjectives?: string[]
  target_audience?: string
  key_benefits?: string[]
  usps?: string[]
  features_and_benefits?: string
  brand_guidelines_analysis?: string
  photography_direction?: PhotographyDirection
  packaging_details?: PackagingDetails
  ad_creative_style?: AdCreativeStyle
  prompt_modifier?: string
  background_colors?: string[]
  cta_style?: string
  competitive_differentiation?: string
  guarantee?: string
  product_type?: string
  social_proof?: Record<string, unknown>

  personas?: Persona[]

  // Loader is intentionally permissive — extra frontmatter keys flow through.
  [key: string]: unknown
}
