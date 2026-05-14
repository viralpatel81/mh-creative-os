// Defends the safe-path resolver against the standard tricks: parent
// dirs, absolute paths, symlink escape, missing files. These are the
// only thing standing between the daemon and arbitrary filesystem reads
// from any HTTP client, so they get explicit per-attack-vector tests.

import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  contentTypeFor,
  resolveArtifactPath,
  UnsafeArtifactPath,
} from '../../src/agentcy/static.js'

function makeArtifactsTree() {
  const root = mkdtempSync(join(tmpdir(), 'mh-static-'))
  const artifactsDir = join(root, 'state', 'artifacts')
  const runDir = join(artifactsDir, 'run_test')
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'ad.png'), Buffer.from('fake-png'))
  writeFileSync(join(runDir, 'inner.json'), '{"k":"v"}')
  // A sibling directory we'll attempt to traverse into:
  writeFileSync(join(root, 'secret.txt'), 'should-never-be-served')
  return { root, artifactsDir }
}

describe('resolveArtifactPath', () => {
  it('returns the resolved path + size for a valid file', () => {
    const { root, artifactsDir } = makeArtifactsTree()
    try {
      const r = resolveArtifactPath(artifactsDir, 'run_test', 'ad.png')
      expect(r.size).toBe(8)
      expect(r.realPath).toMatch(/ad\.png$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects parent-dir traversal in relpath', () => {
    const { root, artifactsDir } = makeArtifactsTree()
    try {
      expect(() => resolveArtifactPath(artifactsDir, 'run_test', '../../secret.txt')).toThrow(
        UnsafeArtifactPath,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an absolute relpath', () => {
    const { root, artifactsDir } = makeArtifactsTree()
    try {
      expect(() => resolveArtifactPath(artifactsDir, 'run_test', '/etc/passwd')).toThrow(
        UnsafeArtifactPath,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a runId containing path separators', () => {
    const { root, artifactsDir } = makeArtifactsTree()
    try {
      expect(() => resolveArtifactPath(artifactsDir, '../run_test', 'ad.png')).toThrow(
        UnsafeArtifactPath,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a null byte in relpath', () => {
    const { root, artifactsDir } = makeArtifactsTree()
    try {
      expect(() => resolveArtifactPath(artifactsDir, 'run_test', 'ad\0.png')).toThrow(
        UnsafeArtifactPath,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a symlink that escapes the artifacts root', () => {
    const { root, artifactsDir } = makeArtifactsTree()
    try {
      symlinkSync(join(root, 'secret.txt'), join(artifactsDir, 'run_test', 'escape.png'))
      expect(() => resolveArtifactPath(artifactsDir, 'run_test', 'escape.png')).toThrow(
        UnsafeArtifactPath,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns 404-equivalent error for a missing file', () => {
    const { root, artifactsDir } = makeArtifactsTree()
    try {
      expect(() => resolveArtifactPath(artifactsDir, 'run_test', 'nope.png')).toThrow(
        UnsafeArtifactPath,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('contentTypeFor', () => {
  it.each([
    ['ad.png', 'image/png'],
    ['hero.jpg', 'image/jpeg'],
    ['hero.JPEG', 'image/jpeg'],
    ['mask.webp', 'image/webp'],
    ['icon.svg', 'image/svg+xml'],
    ['meta.json', 'application/json'],
    ['preview.html', 'text/html'],
    ['readme.md', 'text/plain'],
    ['unknown.xyz', 'application/octet-stream'],
  ])('maps %s -> %s', (filename, expected) => {
    expect(contentTypeFor(filename)).toBe(expected)
  })
})
