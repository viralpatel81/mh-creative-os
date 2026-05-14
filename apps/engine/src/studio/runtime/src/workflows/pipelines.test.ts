// Phase D unit tests for the three workflow pipeline modules. Each
// pipeline is tested in isolation (no end-to-end runtime spin-up) by
// constructing a minimal WorkflowContext and asserting:
//   1. happy path emits exactly one StepOutput with the correct type
//   2. the emitted payload satisfies run_result.v1.extensions
//   3. invalid input is rejected before any artifact is written

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateRunResultV1Extensions } from '@mh/protocols'

import { runAdPipeline } from './ad/pipeline.js'
import { runEmailPipeline } from './email/pipeline.js'
import { runPopupPipeline } from './popup/pipeline.js'
import type { WorkflowContext } from '../runtime/steps.js'
import type { BrandFoundation } from '../domain/types.js'

function fakeBrand(): BrandFoundation {
  // Minimal BrandFoundation — the pipelines only read `id` and pass it
  // through to brand-loader (which we let fall back via the legacy
  // shim, so we never need to write a brand.md fixture for these
  // unit tests).
  return {
    id: 'test-brand',
    name: 'Test Brand',
    positioning: 'A test brand.',
    audiences: [],
    offers: [],
    proofPoints: [],
    pillars: [],
    voice: { tone: '', style: '', do: [], dont: [] },
    channels: {
      social: { objective: '', platforms: [], defaultOffer: null },
      blog: { objective: '' },
      outreach: { objective: '' },
      respond: { objective: '' },
    },
    formats: [],
    handles: {},
    keywords: [],
  } as unknown as BrandFoundation
}

function makeContext(
  workflow: 'ad.post' | 'email.design' | 'popup.design',
  input: Record<string, unknown>,
): { context: WorkflowContext; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'mh-pipeline-'))
  const context: WorkflowContext = {
    brand: fakeBrand(),
    workflow,
    runId: 'test-run',
    input,
    priorArtifacts: [],
    paths: {
      root,
      stateDir: join(root, 'state'),
      artifactsDir: join(root, 'state', 'artifacts'),
      exportsDir: join(root, 'state', 'exports'),
      dbPath: join(root, 'state', 'loom.sqlite'),
      brandsDir: join(root, 'brands'),
    },
  }
  return { context, root }
}

describe('runAdPipeline', () => {
  it('emits one ad_output artifact per request with schema-valid payload', async () => {
    const { context, root } = makeContext('ad.post', {
      aspects: ['1:1', '3:4'],
      engine: 'gemini',
      layout_mode: 'strategy',
    })
    try {
      const outputs = await runAdPipeline(context)
      expect(outputs).toHaveLength(1)
      expect(outputs[0].type).toBe('ad_output')
      validateRunResultV1Extensions({ ad_output: outputs[0].data })
      const images = (outputs[0].data as { images: Array<{ aspect: string }> }).images
      expect(images.map((i) => i.aspect)).toEqual(['1:1', '3:4'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an unknown aspect ratio', async () => {
    const { context, root } = makeContext('ad.post', {
      aspects: ['16:9'],
      engine: 'gemini',
      layout_mode: 'strategy',
    })
    try {
      await expect(runAdPipeline(context)).rejects.toThrow(/invalid request/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('runEmailPipeline', () => {
  it('emits one email_output artifact carrying the purpose and aspects', async () => {
    const { context, root } = makeContext('email.design', {
      aspects: ['3:4'],
      engine: 'gemini',
      purpose: 'welcome',
    })
    try {
      const outputs = await runEmailPipeline(context)
      expect(outputs).toHaveLength(1)
      expect(outputs[0].type).toBe('email_output')
      validateRunResultV1Extensions({ email_output: outputs[0].data })
      expect((outputs[0].data as { purpose: string }).purpose).toBe('welcome')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an unsupported aspect ratio for emails', async () => {
    const { context, root } = makeContext('email.design', {
      aspects: ['1:1'], // valid for ads, not for emails
      engine: 'gemini',
      purpose: 'welcome',
    })
    try {
      await expect(runEmailPipeline(context)).rejects.toThrow(/invalid request/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('runPopupPipeline', () => {
  it('emits one popup_output artifact with the popup purpose', async () => {
    const { context, root } = makeContext('popup.design', {
      aspects: ['1:1'],
      engine: 'openai',
      purpose: 'email-capture',
    })
    try {
      const outputs = await runPopupPipeline(context)
      expect(outputs).toHaveLength(1)
      expect(outputs[0].type).toBe('popup_output')
      validateRunResultV1Extensions({ popup_output: outputs[0].data })
      expect((outputs[0].data as { purpose: string }).purpose).toBe('email-capture')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an email purpose used on a popup', async () => {
    const { context, root } = makeContext('popup.design', {
      aspects: ['1:1'],
      engine: 'gemini',
      purpose: 'welcome', // valid for email, not popup
    })
    try {
      await expect(runPopupPipeline(context)).rejects.toThrow(/invalid request/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
