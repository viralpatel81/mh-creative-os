// popup.design workflow — Phase D first cut.
//
// Mirrors ad/pipeline.ts and email/pipeline.ts with the PopupPurpose
// enum. Phase D2 ports mh2/src/services/popup.ts behind this entry.

import {
  validatePopupRequestV1,
  ProtocolValidationError,
  type PopupRequestV1,
} from '@mh/protocols'

import type { WorkflowContext, StepOutput } from '../../runtime/steps.js'
import { asStepOutput, buildStubImages, resolveBrandFromContext, stubMarker } from '../_shared.js'

function normalizeRequest(context: WorkflowContext): PopupRequestV1 {
  const input = context.input
  const aspects = Array.isArray(input.aspects) ? (input.aspects as string[]) : ['1:1']
  const engine = input.engine === 'openai' ? 'openai' : 'gemini'
  const purpose = typeof input.purpose === 'string' ? input.purpose : 'custom'
  const candidate: Record<string, unknown> = {
    brand_id: context.brand.id,
    aspects,
    engine,
    purpose,
  }
  if (typeof input.brief_text === 'string') candidate.brief_text = input.brief_text
  if (Array.isArray(input.vault_refs)) candidate.vault_refs = input.vault_refs
  if (Array.isArray(input.asset_ids)) candidate.asset_ids = input.asset_ids
  if (typeof input.quantity === 'number') candidate.quantity = input.quantity
  if (typeof input.custom_description === 'string') {
    candidate.custom_description = input.custom_description
  }
  return candidate as unknown as PopupRequestV1
}

export async function runPopupPipeline(context: WorkflowContext): Promise<StepOutput[]> {
  const request = normalizeRequest(context)
  try {
    validatePopupRequestV1(request)
  } catch (err) {
    if (err instanceof ProtocolValidationError) {
      throw new Error(`popup.design: invalid request — ${err.message}`)
    }
    throw err
  }

  const { profile } = resolveBrandFromContext(context)

  const images = buildStubImages(context, request.aspects, request.engine, 'popup')

  return asStepOutput('popup_output', {
    ...stubMarker(profile.id),
    purpose: request.purpose,
    images,
  })
}
