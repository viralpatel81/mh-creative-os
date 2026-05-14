import { describe, it, expect } from 'vitest'
import {
  ProtocolValidationError,
  validateAdRequestV1,
  validateEmailRequestV1,
  validatePopupRequestV1,
  validateRunResultV1Extensions,
} from '../src/index.js'

describe('ad_request.v1', () => {
  it('accepts a minimal valid payload', () => {
    validateAdRequestV1({
      brand_id: 'givecare',
      aspects: ['1:1'],
      engine: 'gemini',
      layout_mode: 'strategy',
    })
  })

  it('accepts a fully populated payload', () => {
    validateAdRequestV1({
      schema_version: 'ad_request.v1',
      brand_id: 'givecare',
      brief_text: 'Launch.',
      aspects: ['1:1', '3:4', '9:16'],
      engine: 'openai',
      model_tier: 'hd',
      layout_mode: 'template',
      vault_refs: ['t-1', 't-2'],
      asset_ids: ['a-1'],
      quantity: 2,
      purpose: 'launch',
      custom_description: 'A short note.',
    })
  })

  it('rejects unknown aspect', () => {
    expect(() =>
      validateAdRequestV1({
        brand_id: 'x',
        aspects: ['16:9'],
        engine: 'gemini',
        layout_mode: 'strategy',
      }),
    ).toThrow(ProtocolValidationError)
  })

  it('rejects extra top-level fields', () => {
    expect(() =>
      validateAdRequestV1({
        brand_id: 'x',
        aspects: ['1:1'],
        engine: 'gemini',
        layout_mode: 'strategy',
        rogue: true,
      }),
    ).toThrow(ProtocolValidationError)
  })

  it('rejects missing required field', () => {
    expect(() =>
      validateAdRequestV1({
        brand_id: 'x',
        aspects: ['1:1'],
        engine: 'gemini',
      }),
    ).toThrow(ProtocolValidationError)
  })

  it('rejects empty aspects', () => {
    expect(() =>
      validateAdRequestV1({
        brand_id: 'x',
        aspects: [],
        engine: 'gemini',
        layout_mode: 'strategy',
      }),
    ).toThrow(ProtocolValidationError)
  })
})

describe('email_request.v1', () => {
  it('accepts a minimal valid payload', () => {
    validateEmailRequestV1({
      brand_id: 'givecare',
      aspects: ['3:4'],
      engine: 'gemini',
      purpose: 'welcome',
    })
  })

  it('rejects invalid purpose', () => {
    expect(() =>
      validateEmailRequestV1({
        brand_id: 'x',
        aspects: ['3:4'],
        engine: 'gemini',
        purpose: 'not-a-thing',
      }),
    ).toThrow(ProtocolValidationError)
  })

  it('rejects ad-shaped aspect ratio', () => {
    expect(() =>
      validateEmailRequestV1({
        brand_id: 'x',
        aspects: ['1:1'],
        engine: 'gemini',
        purpose: 'welcome',
      }),
    ).toThrow(ProtocolValidationError)
  })
})

describe('popup_request.v1', () => {
  it('accepts a minimal valid payload', () => {
    validatePopupRequestV1({
      brand_id: 'givecare',
      aspects: ['1:1'],
      engine: 'openai',
      purpose: 'email-capture',
    })
  })

  it('rejects an email-shaped purpose', () => {
    expect(() =>
      validatePopupRequestV1({
        brand_id: 'x',
        aspects: ['1:1'],
        engine: 'gemini',
        purpose: 'welcome',
      }),
    ).toThrow(ProtocolValidationError)
  })
})

describe('run_result.v1.extensions', () => {
  it('accepts ad_output with minimal images', () => {
    validateRunResultV1Extensions({
      ad_output: { images: [{ aspect: '1:1', path: 'p.png' }] },
    })
  })

  it('accepts email_output', () => {
    validateRunResultV1Extensions({
      email_output: {
        purpose: 'welcome',
        images: [{ aspect: '3:4', path: 'e.png' }],
      },
    })
  })

  it('rejects unknown image field', () => {
    expect(() =>
      validateRunResultV1Extensions({
        ad_output: {
          images: [{ aspect: '1:1', path: 'p.png', rogue: 'x' }],
        },
      }),
    ).toThrow(ProtocolValidationError)
  })
})
