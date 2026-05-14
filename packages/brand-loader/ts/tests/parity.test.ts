// Parity test runner — for each fixture under ../tests/fixtures/, invoke
// the Python loader and the TypeScript loader on the same brand.md and
// assert their normalized JSON outputs deep-equal each other AND the
// fixture's expected.json. Drift between the two implementations becomes
// a hard fail before any consumer (agentcy Python, studio TS) sees the
// discrepancy.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBrandProfile } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(HERE, '..', '..', 'tests', 'fixtures')
const PYTHON_RUNNER = join(HERE, '..', '..', 'tests', 'python_runner.py')

function listFixtures(): string[] {
  if (!existsSync(FIXTURES_DIR)) return []
  return readdirSync(FIXTURES_DIR).filter((entry) => {
    const full = join(FIXTURES_DIR, entry)
    return statSync(full).isDirectory() && existsSync(join(full, 'brand.md'))
  })
}

function runPythonLoader(brandDir: string): unknown {
  const result = spawnSync('uv', ['run', '--project', join(HERE, '..', '..', 'python'), 'python', PYTHON_RUNNER, brandDir], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(
      `Python loader runner failed (exit ${result.status}):\n  stdout: ${result.stdout}\n  stderr: ${result.stderr}`,
    )
  }
  return JSON.parse(result.stdout)
}

describe('brand-loader parity (Python vs TypeScript)', () => {
  const fixtures = listFixtures()

  if (fixtures.length === 0) {
    it.skip('no fixtures found — skipping', () => {})
    return
  }

  for (const fixture of fixtures) {
    it(`agrees with Python on fixture "${fixture}"`, () => {
      const brandDir = join(FIXTURES_DIR, fixture)
      const tsResult = loadBrandProfile(brandDir)
      const pyResult = runPythonLoader(brandDir)
      expect(tsResult).toEqual(pyResult)
    })

    const expectedPath = join(FIXTURES_DIR, fixture, 'expected.json')
    if (existsSync(expectedPath)) {
      it(`matches expected.json on fixture "${fixture}"`, () => {
        const expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
        const tsResult = loadBrandProfile(join(FIXTURES_DIR, fixture))
        expect(tsResult).toEqual(expected)
      })
    }
  }
})
