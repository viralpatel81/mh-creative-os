// Phase E3.2 — image artifact rendering tests.
//
// Covers three seams:
//   1. The streaming parser surfaces `src` from a tag attribute and
//      handles the self-closing form image artifacts use in practice.
//   2. The renderer registry maps an image manifest (or an image
//      ProjectFile) to the new ImageRenderer.
//   3. resolveImageSrc normalizes the engine's filesystem-shaped src
//      into the daemon's static-artifact URL.

import { describe, expect, it } from 'vitest'

import { createArtifactParser } from '../../src/artifacts/parser'
import {
  ImageRenderer,
  RendererRegistry,
  HtmlRenderer,
  DeckHtmlRenderer,
  MarkdownRenderer,
  ReactComponentRenderer,
  SvgRenderer,
  artifactRendererRegistry,
} from '../../src/artifacts/renderer-registry'
import { resolveImageSrc } from '../../src/artifacts/image-url'
import type { ProjectFile } from '../../src/types'

function baseFile(overrides: Partial<ProjectFile> & Pick<ProjectFile, 'name'>): ProjectFile {
  return {
    path: 'artifact.png',
    type: 'file',
    size: 1,
    mtime: Date.now(),
    kind: 'image',
    mime: 'image/png',
    ...overrides,
  }
}

describe('parser: image artifact (self-closing with src)', () => {
  it('emits artifact:start with src and an immediate artifact:end for <artifact ... />', () => {
    const parser = createArtifactParser()
    const events = [
      ...parser.feed(
        '<artifact identifier="ad-1x1" type="image/png" title="Caregiver 1:1" src="state/artifacts/run_abc/ad-1x1.png" />',
      ),
    ]
    const start = events.find((e) => e.type === 'artifact:start')
    expect(start).toMatchObject({
      type: 'artifact:start',
      identifier: 'ad-1x1',
      artifactType: 'image/png',
      title: 'Caregiver 1:1',
      src: 'state/artifacts/run_abc/ad-1x1.png',
    })
    const end = events.find((e) => e.type === 'artifact:end')
    expect(end).toMatchObject({ type: 'artifact:end', identifier: 'ad-1x1', fullContent: '' })
  })

  it('does not leave the parser in `inside` state after a self-closing tag', () => {
    const parser = createArtifactParser()
    const events = [
      ...parser.feed(
        '<artifact identifier="x" type="image/png" src="state/artifacts/r/x.png" />',
      ),
      ...parser.feed('more text afterwards'),
    ]
    // The trailing text must surface as a `text` event — proves the
    // parser closed the artifact and reverted to outside state.
    const tailText = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')
    expect(tailText).toContain('more text afterwards')
  })

  it('still supports the traditional paired form for non-image artifacts', () => {
    const parser = createArtifactParser()
    const events = [
      ...parser.feed('<artifact identifier="hello" type="text/html" title="Hello">'),
      ...parser.feed('<p>hi</p>'),
      ...parser.feed('</artifact>'),
    ]
    const start = events.find((e) => e.type === 'artifact:start')
    expect(start).toMatchObject({ type: 'artifact:start', artifactType: 'text/html' })
    const end = events.find((e) => e.type === 'artifact:end') as
      | { type: 'artifact:end'; fullContent: string }
      | undefined
    expect(end?.fullContent).toBe('<p>hi</p>')
  })
})

describe('RendererRegistry: ImageRenderer routing', () => {
  const registry = new RendererRegistry([
    ReactComponentRenderer,
    ImageRenderer,
    DeckHtmlRenderer,
    HtmlRenderer,
    MarkdownRenderer,
    SvgRenderer,
  ])

  it('resolves image renderer from an explicit image manifest', () => {
    const file = baseFile({
      name: 'ad-1x1.png',
      artifactManifest: {
        version: 1,
        kind: 'image',
        title: 'Caregiver 1:1',
        entry: 'ad-1x1.png',
        renderer: 'image',
        exports: ['zip'],
      },
    })
    const match = registry.resolve({ file, isDeckHint: false })
    expect(match?.renderer.id).toBe('image')
    expect(match?.manifest.kind).toBe('image')
  })

  it('resolves image renderer when manifest carries metadata.artifactType="image/png"', () => {
    const file = baseFile({
      name: 'shot.bin',
      kind: 'image',
      mime: 'image/png',
      artifactManifest: {
        version: 1,
        kind: 'html', // engine produced an unexpected kind but the
        // streaming parser tagged the artifact with image/png.
        title: 'Shot',
        entry: 'shot.bin',
        renderer: 'html',
        exports: ['html'],
        metadata: { artifactType: 'image/png' },
      },
    })
    const match = registry.resolve({ file, isDeckHint: false })
    expect(match?.renderer.id).toBe('image')
  })

  it('falls back to inferred image manifest for raster files without explicit manifest', () => {
    const file = baseFile({ name: 'render.png', artifactManifest: undefined })
    const match = registry.resolve({ file, isDeckHint: false })
    expect(match?.renderer.id).toBe('image')
    expect(match?.manifest.kind).toBe('image')
  })

  it('does NOT route SVGs to the image renderer (SvgRenderer wins)', () => {
    const file = baseFile({
      name: 'diagram.svg',
      mime: 'image/svg+xml',
      kind: 'image',
      artifactManifest: undefined,
    })
    const match = registry.resolve({ file, isDeckHint: false })
    expect(match?.renderer.id).toBe('svg')
  })

  it('is part of the default exported registry', () => {
    const file = baseFile({
      name: 'frame.png',
      artifactManifest: {
        version: 1,
        kind: 'image',
        title: 'Frame',
        entry: 'frame.png',
        renderer: 'image',
        exports: ['zip'],
      },
    })
    const match = artifactRendererRegistry.resolve({ file, isDeckHint: false })
    expect(match?.renderer.id).toBe('image')
  })
})

describe('resolveImageSrc', () => {
  it('rewrites a filesystem-shaped engine path to the daemon URL', () => {
    expect(resolveImageSrc('state/artifacts/run_abc/ad-1x1.png')).toBe(
      '/api/agentcy/artifacts/run_abc/ad-1x1.png',
    )
  })

  it('passes through a daemon-shaped URL with leading slash', () => {
    expect(resolveImageSrc('/api/agentcy/artifacts/run_abc/ad-1x1.png')).toBe(
      '/api/agentcy/artifacts/run_abc/ad-1x1.png',
    )
  })

  it('normalizes a daemon-shaped URL missing the leading slash', () => {
    expect(resolveImageSrc('api/agentcy/artifacts/run_abc/ad-1x1.png')).toBe(
      '/api/agentcy/artifacts/run_abc/ad-1x1.png',
    )
  })

  it('passes through absolute http(s) URLs', () => {
    expect(resolveImageSrc('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })

  it('passes through data: URIs', () => {
    expect(resolveImageSrc('data:image/png;base64,iVBORw0KG=')).toBe(
      'data:image/png;base64,iVBORw0KG=',
    )
  })

  it('assembles a bare filename when a runId is provided', () => {
    expect(resolveImageSrc('ad-1x1.png', { runId: 'run_abc' })).toBe(
      '/api/agentcy/artifacts/run_abc/ad-1x1.png',
    )
  })

  it('returns null for an empty or unresolved src', () => {
    expect(resolveImageSrc('')).toBeNull()
    expect(resolveImageSrc('   ')).toBeNull()
    expect(resolveImageSrc('mystery/path')).toBeNull()
  })

  it('refuses path traversal on the bare-filename path', () => {
    expect(resolveImageSrc('../escape.png', { runId: 'run_abc' })).toBeNull()
  })
})
