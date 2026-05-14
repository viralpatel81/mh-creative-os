// Pure-function tests for spawn.ts. The actual subprocess spawn is
// exercised by the engine smokes elsewhere; here we cover the CLI-arg
// flattening logic in isolation.

import { describe, it, expect } from 'vitest'
import { paramsToCliArgs } from '../../src/agentcy/spawn.js'

describe('paramsToCliArgs', () => {
  it('returns an empty list for an empty params object', () => {
    expect(paramsToCliArgs({})).toEqual([])
  })

  it('drops undefined and null values', () => {
    expect(paramsToCliArgs({ a: undefined, b: null, c: 'kept' })).toEqual(['--c', 'kept'])
  })

  it('emits a bare flag for true booleans and skips false', () => {
    expect(paramsToCliArgs({ a: true, b: false })).toEqual(['--a'])
  })

  it('emits a JSON-encoded value for arrays', () => {
    expect(paramsToCliArgs({ aspects: ['1:1', '3:4'] })).toEqual([
      '--aspects',
      '["1:1","3:4"]',
    ])
  })

  it('stringifies primitive values', () => {
    expect(paramsToCliArgs({ engine: 'gemini', quantity: 3 })).toEqual([
      '--engine',
      'gemini',
      '--quantity',
      '3',
    ])
  })
})
