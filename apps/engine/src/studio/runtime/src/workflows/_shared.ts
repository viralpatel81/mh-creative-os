// Shared helpers for the ad / email / popup workflow pipelines. These
// pipelines are the "monolithic wrap" target from architecture plan v5
// §1.4 — each one validates its request payload, loads the brand, runs
// the (eventually-ported-from-mh2) generation logic, and emits an
// `*_output` artifact that satisfies the run_result.v1.extensions schema.
//
// In this Phase D first cut, the wrapped generation logic is a
// deterministic stub that produces schema-conforming output without
// calling any LLM or image engine. Phase D2 ports the actual mh2
// services/{claude,gemini,openai,email,popup}.ts behind this same
// interface — callers (the daemon spawning subprocesses) don't need to
// change when that lands.

import { loadBrandProfile, type BrandProfile, BrandLoaderError } from '@mh/brand-loader'

import type { BrandFoundation } from '../domain/types.js'
import type { WorkflowContext, StepOutput } from '../runtime/steps.js'

export interface ResolvedBrand {
  /** Brand profile read from brands/<id>/brand.md (canonical, mh2-extended). */
  profile: BrandProfile
  /** Path to the brand directory, anchored under the runtime root. */
  brandDir: string
}

export function resolveBrandFromContext(
  context: WorkflowContext,
  brandsRootOverride?: string,
): ResolvedBrand {
  const brandsRoot = brandsRootOverride ?? `${context.paths.root}/brands`
  const brandDir = `${brandsRoot}/${context.brand.id}`
  try {
    return { profile: loadBrandProfile(brandDir), brandDir }
  } catch (err) {
    if (err instanceof BrandLoaderError) {
      // Mirror the legacy BrandFoundation into a minimal canonical
      // BrandProfile so workflows can keep going against brands that
      // haven't been migrated to brand.md yet. This is a temporary
      // shim that goes away once Phase J sunsets the legacy paths.
      return { profile: legacyToProfile(context.brand), brandDir }
    }
    throw err
  }
}

function legacyToProfile(foundation: BrandFoundation): BrandProfile {
  return {
    id: foundation.id,
    name: foundation.name,
    positioning: foundation.positioning,
  }
}

/**
 * Build a stub `*_output` payload for the Phase D first cut. Real
 * generation logic lands in Phase D2 (mh2 service port).
 *
 * Returns one artifact per `aspects` entry. The path is deterministic so
 * downstream consumers (daemon static-serve, Phase F parity tests) can
 * predict where to look.
 */
export function buildStubImages<Aspect extends string>(
  context: WorkflowContext,
  aspects: Aspect[],
  engine: 'gemini' | 'openai',
  kind: 'ad' | 'email' | 'popup',
): Array<{ aspect: Aspect; path: string; engine: 'gemini' | 'openai' }> {
  return aspects.map((aspect) => ({
    aspect,
    path: `state/artifacts/${context.runId}/stub-${kind}-${aspect.replace(':', 'x')}.png`,
    engine,
  }))
}

/**
 * Marker the engine writes onto every stub output so callers (Phase F
 * parity harness, daemon UI) can distinguish a real generation from a
 * Phase D first-cut stub without inspecting bytes.
 */
export function stubMarker(brandId: string): Record<string, unknown> {
  return { stub: true, brand: brandId }
}

/**
 * Build a single StepOutput with the given output-block type and payload.
 * Centralized so step builders stay short and so the artifact shape is
 * easy to grep for when Phase D2 swaps in real generation.
 */
export function asStepOutput(
  type: 'ad_output' | 'email_output' | 'popup_output',
  payload: Record<string, unknown>,
): StepOutput[] {
  return [{ type, data: payload }]
}
