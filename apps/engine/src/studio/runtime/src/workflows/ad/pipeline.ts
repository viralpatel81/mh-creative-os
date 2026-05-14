// ad.post workflow — Phase D first cut.
//
// Pipeline shape (one logical "render" step in the runtime registry, but
// internally a sequence the real mh2 port will fill in):
//
//   validate request -> load brand -> [Phase D2: strategy / template select /
//   asset analysis / prompt build / image generation / QA] -> assemble ad_output
//
// This first cut validates the request via @mh/protocols, loads the
// brand via @mh/brand-loader (falling back to the legacy BrandFoundation
// when brand.md is missing), and emits a deterministic stub output that
// satisfies run_result.v1.extensions. Phase D2 swaps the inner steps for
// the ported mh2 services without changing this entry's signature.

import {
  validateAdRequestV1,
  ProtocolValidationError,
  type AdRequestV1,
} from '@mh/protocols'

import type { WorkflowContext, StepOutput } from '../../runtime/steps.js'
import { asStepOutput, buildStubImages, resolveBrandFromContext, stubMarker } from '../_shared.js'

/**
 * Coerce arbitrary CLI / daemon input into an ad_request.v1 payload.
 * Mostly defensive — the daemon validates before spawning, but the CLI
 * path can hand us looser shapes.
 */
function normalizeRequest(context: WorkflowContext): AdRequestV1 {
  const input = context.input
  const aspects = Array.isArray(input.aspects) ? (input.aspects as string[]) : ['1:1']
  const engine = input.engine === 'openai' ? 'openai' : 'gemini'
  const layoutMode = input.layout_mode === 'template' ? 'template' : 'strategy'
  const candidate: Record<string, unknown> = {
    brand_id: context.brand.id,
    aspects,
    engine,
    layout_mode: layoutMode,
  }
  if (typeof input.brief_text === 'string') candidate.brief_text = input.brief_text
  if (typeof input.model_tier === 'string') candidate.model_tier = input.model_tier
  if (Array.isArray(input.vault_refs)) candidate.vault_refs = input.vault_refs
  if (Array.isArray(input.asset_ids)) candidate.asset_ids = input.asset_ids
  if (typeof input.quantity === 'number') candidate.quantity = input.quantity
  if (typeof input.purpose === 'string') candidate.purpose = input.purpose
  if (typeof input.custom_description === 'string') {
    candidate.custom_description = input.custom_description
  }
  return candidate as unknown as AdRequestV1
}

export async function runAdPipeline(context: WorkflowContext): Promise<StepOutput[]> {
  const request = normalizeRequest(context)
  try {
    validateAdRequestV1(request)
  } catch (err) {
    if (err instanceof ProtocolValidationError) {
      throw new Error(`ad.post: invalid request — ${(err as Error).message}`)
    }
    throw err
  }

  const { profile } = resolveBrandFromContext(context)

  // Phase D2 hook point: replace the buildStubImages() call with a real
  // sequence that consumes `profile`, `request.vault_refs`, and
  // `request.asset_ids` to produce real PNGs at the predicted paths.
  const images = buildStubImages(context, request.aspects, request.engine, 'ad')

  return asStepOutput('ad_output', {
    ...stubMarker(profile.id),
    layout_mode: request.layout_mode,
    images,
  })
}
