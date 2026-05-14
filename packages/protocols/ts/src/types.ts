// Mirrors of the JSON Schemas in ../../schemas/. Hand-authored rather
// than generated so consumers get precise discriminated unions; the
// runtime validator in validators.ts enforces conformance against the
// JSON Schema itself so types and schema can't silently diverge.

export type AdAspect = '1:1' | '3:4' | '9:16'
export type EmailAspect = '2:3' | '3:4' | '9:16'
export type PopupAspect = '1:1' | '4:5' | '3:4'
export type Engine = 'gemini' | 'openai'

export type EmailPurpose =
  | 'welcome'
  | 'abandoned-cart'
  | 'win-back'
  | 'promo'
  | 'retention'
  | 'announcement'
  | 'transactional'
  | 'custom'

export type PopupPurpose =
  | 'email-capture'
  | 'discount-offer'
  | 'free-shipping'
  | 'spin-to-win'
  | 'exit-intent'
  | 'announcement'
  | 'preference-quiz'
  | 'cart-recovery'
  | 'custom'

export interface AdRequestV1 {
  schema_version?: 'ad_request.v1'
  brand_id: string
  brief_text?: string
  aspects: AdAspect[]
  engine: Engine
  model_tier?: 'standard' | 'hd' | '2k'
  layout_mode: 'strategy' | 'template'
  vault_refs?: string[]
  asset_ids?: string[]
  quantity?: number
  purpose?: string
  custom_description?: string
}

export interface EmailRequestV1 {
  schema_version?: 'email_request.v1'
  brand_id: string
  brief_text?: string
  purpose: EmailPurpose
  aspects: EmailAspect[]
  engine: Engine
  layout_mode?: 'strategy' | 'template'
  vault_refs?: string[]
  asset_ids?: string[]
  quantity?: number
  custom_description?: string
}

export interface PopupRequestV1 {
  schema_version?: 'popup_request.v1'
  brand_id: string
  brief_text?: string
  purpose: PopupPurpose
  aspects: PopupAspect[]
  engine: Engine
  vault_refs?: string[]
  asset_ids?: string[]
  quantity?: number
  custom_description?: string
}

export interface AdOutputImage {
  aspect: AdAspect
  path: string
  template_id?: string
  engine?: Engine
  qa?: { passed?: boolean; concerns?: string }
}

export interface AdOutput {
  images: AdOutputImage[]
}

export interface EmailOutputImage {
  aspect: EmailAspect
  path: string
  engine?: Engine
}

export interface EmailOutput {
  purpose?: string
  images: EmailOutputImage[]
}

export interface PopupOutputImage {
  aspect: PopupAspect
  path: string
  engine?: Engine
}

export interface PopupOutput {
  purpose?: string
  images: PopupOutputImage[]
}

export interface RunResultV1Extensions {
  ad_output?: AdOutput
  email_output?: EmailOutput
  popup_output?: PopupOutput
}
