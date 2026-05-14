// email.design workflow — Phase D first cut.
//
// Mirrors ad/pipeline.ts but with email-specific aspect ratios and the
// EmailPurpose enum gating the request shape. Phase D2 ports
// mh2/src/services/email.ts behind this entry point.

import {
  validateEmailRequestV1,
  ProtocolValidationError,
  type EmailRequestV1,
} from '@mh/protocols'

import type { WorkflowContext, StepOutput } from '../../runtime/steps.js'
import { asStepOutput, buildStubImages, resolveBrandFromContext, stubMarker } from '../_shared.js'

function normalizeRequest(context: WorkflowContext): EmailRequestV1 {
  const input = context.input
  const aspects = Array.isArray(input.aspects) ? (input.aspects as string[]) : ['3:4']
  const engine = input.engine === 'openai' ? 'openai' : 'gemini'
  const purpose = typeof input.purpose === 'string' ? input.purpose : 'custom'
  const candidate: Record<string, unknown> = {
    brand_id: context.brand.id,
    aspects,
    engine,
    purpose,
  }
  if (typeof input.brief_text === 'string') candidate.brief_text = input.brief_text
  if (typeof input.layout_mode === 'string') candidate.layout_mode = input.layout_mode
  if (Array.isArray(input.vault_refs)) candidate.vault_refs = input.vault_refs
  if (Array.isArray(input.asset_ids)) candidate.asset_ids = input.asset_ids
  if (typeof input.quantity === 'number') candidate.quantity = input.quantity
  if (typeof input.custom_description === 'string') {
    candidate.custom_description = input.custom_description
  }
  return candidate as unknown as EmailRequestV1
}

export async function runEmailPipeline(context: WorkflowContext): Promise<StepOutput[]> {
  const request = normalizeRequest(context)
  try {
    validateEmailRequestV1(request)
  } catch (err) {
    if (err instanceof ProtocolValidationError) {
      throw new Error(`email.design: invalid request — ${err.message}`)
    }
    throw err
  }

  const { profile } = resolveBrandFromContext(context)

  const images = buildStubImages(context, request.aspects, request.engine, 'email')

  return asStepOutput('email_output', {
    ...stubMarker(profile.id),
    purpose: request.purpose,
    images,
  })
}
