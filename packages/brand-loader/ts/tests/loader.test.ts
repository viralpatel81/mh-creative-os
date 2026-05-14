import { describe, it, expect } from 'vitest'
import {
  BrandLoaderError,
  loadBrandProfileFromText,
  parseFrontmatter,
} from '../src/loader.js'

describe('parseFrontmatter', () => {
  it('returns empty frontmatter and original body when no delimiter is present', () => {
    const result = parseFrontmatter('plain body, no frontmatter')
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('plain body, no frontmatter')
  })

  it('parses a minimal frontmatter block', () => {
    const result = parseFrontmatter('---\nid: x\nname: X\n---\nbody\n')
    expect(result.frontmatter).toEqual({ id: 'x', name: 'X' })
    expect(result.body).toBe('body\n')
  })
})

describe('loadBrandProfileFromText', () => {
  it('throws when id is missing', () => {
    expect(() => loadBrandProfileFromText('---\nname: x\n---\n')).toThrow(BrandLoaderError)
  })

  it('throws when name is missing', () => {
    expect(() => loadBrandProfileFromText('---\nid: x\n---\n')).toThrow(BrandLoaderError)
  })

  it('throws when frontmatter is not a mapping', () => {
    expect(() => loadBrandProfileFromText('---\n- 1\n- 2\n---\n')).toThrow(/must be a YAML mapping/)
  })

  it('throws on invalid YAML', () => {
    expect(() => loadBrandProfileFromText('---\nid: [unterminated\n---\n')).toThrow(
      /invalid YAML frontmatter/,
    )
  })
})
