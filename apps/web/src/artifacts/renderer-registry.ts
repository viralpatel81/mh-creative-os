// MODIFIED 2026-05-13 by mh-creative-os fork:
// Added ImageRenderer (Phase E3.2) so engine-emitted image artifacts
// — <artifact type="image/png" src="..."> — resolve to the existing
// image viewer path. Registered after ReactComponentRenderer + before
// the deck/html renderers so an explicit image manifest wins over a
// fallback inferred html match.
// Upstream: nexu-io/open-design @ 7c8305f4

import { inferLegacyManifest } from './manifest';
import { renderMarkdownToSafeHtml } from './markdown';
import type { ArtifactManifest, ArtifactRendererId } from './types';
import type { ProjectFile } from '../types';

export interface ArtifactRendererContext {
  file: ProjectFile;
  isDeckHint: boolean;
}

export interface ArtifactRenderer {
  id: ArtifactRendererId;
  /**
   * Whether this renderer can receive partial content during streaming.
   * - true + renderPartial defined → renderer produces useful intermediate output
   * - true without renderPartial → renderer tolerates partial content but
   *   should be considered visually meaningful only when status === "complete"
   * - false → consumer should show skeleton/loading state until status === "complete"
   */
  supportsStreaming: boolean;
  renderPartial?: (content: string) => string;
  canRender: (ctx: ArtifactRendererContext) => boolean;
}

export interface ArtifactRenderMatch {
  renderer: ArtifactRenderer;
  manifest: ArtifactManifest;
}

function resolveManifest(file: ProjectFile): ArtifactManifest | null {
  return file.artifactManifest ?? inferLegacyManifest({ entry: file.name });
}

export const HtmlRenderer: ArtifactRenderer = {
  id: 'html',
  supportsStreaming: false,
  canRender: ({ file, isDeckHint }) => {
    const manifest = resolveManifest(file);
    if (!manifest) return false;
    if (manifest.kind === 'deck' || manifest.renderer === 'deck-html') return false;
    if (manifest.renderer === 'html' || manifest.kind === 'html') return true;
    return file.kind === 'html' && !isDeckHint;
  },
};

export const DeckHtmlRenderer: ArtifactRenderer = {
  id: 'deck-html',
  supportsStreaming: false,
  canRender: ({ file, isDeckHint }) => {
    const manifest = resolveManifest(file);
    if (!manifest) return false;
    if (manifest.kind === 'deck' || manifest.renderer === 'deck-html') return true;
    return file.kind === 'html' && isDeckHint;
  },
};

export const ReactComponentRenderer: ArtifactRenderer = {
  id: 'react-component',
  supportsStreaming: false,
  canRender: ({ file }) => {
    const manifest = resolveManifest(file);
    if (!manifest) return false;
    return manifest.kind === 'react-component' || manifest.renderer === 'react-component';
  },
};

export const MarkdownRenderer: ArtifactRenderer = {
  id: 'markdown',
  supportsStreaming: true,
  renderPartial: renderMarkdownToSafeHtml,
  canRender: ({ file }) => {
    const manifest = resolveManifest(file);
    if (!manifest) return false;
    if (manifest.renderer === 'markdown' || manifest.kind === 'markdown-document') return true;
    return file.kind === 'text' && /\.md$/i.test(file.name);
  },
};

export const SvgRenderer: ArtifactRenderer = {
  id: 'svg',
  supportsStreaming: false,
  canRender: ({ file }) => {
    const manifest = resolveManifest(file);
    if (!manifest) return false;
    if (manifest.renderer === 'svg' || manifest.kind === 'svg') return true;
    return (file.kind === 'image' || file.kind === 'sketch') && /\.svg$/i.test(file.name);
  },
};

export const ImageRenderer: ArtifactRenderer = {
  id: 'image',
  supportsStreaming: false,
  canRender: ({ file }) => {
    const manifest = resolveManifest(file);
    if (!manifest) return false;
    // Explicit image manifest wins.
    if (manifest.renderer === 'image' || manifest.kind === 'image') return true;
    // Manifest carries an artifact-tag-derived `type` (e.g. "image/png")
    // when the producer was the streaming parser — match the MIME-family
    // prefix so any raster image type slots into this renderer.
    const tagType =
      typeof manifest.metadata?.artifactType === 'string'
        ? (manifest.metadata.artifactType as string)
        : '';
    if (tagType.startsWith('image/') && !tagType.includes('svg')) return true;
    // Filesystem fallback: a project file with a raster image extension
    // and no other manifest match. SVG is intentionally NOT routed here
    // — it has its own renderer with inline DOM rendering.
    return file.kind === 'image' && !/\.svg$/i.test(file.name);
  },
};

export class RendererRegistry {
  constructor(private readonly renderers: ArtifactRenderer[]) {}

  resolve(ctx: ArtifactRendererContext): ArtifactRenderMatch | null {
    const manifest = resolveManifest(ctx.file);
    if (!manifest) return null;
    const renderer = this.renderers.find((item) => item.canRender(ctx));
    if (!renderer) return null;
    return { renderer, manifest };
  }
}

export const artifactRendererRegistry = new RendererRegistry([
  ReactComponentRenderer,
  ImageRenderer,
  DeckHtmlRenderer,
  HtmlRenderer,
  MarkdownRenderer,
  SvgRenderer,
]);
