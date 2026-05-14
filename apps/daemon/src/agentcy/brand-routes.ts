// Brand profile read endpoints for the agentcy bridge.
//
// Backed by @mh/brand-loader. The brand directory layout is:
//
//   <engineRoot>/brands/<brandId>/brand.md
//   <engineRoot>/brands/<brandId>/design.md    # optional
//   <engineRoot>/brands/<brandId>/assets/...   # optional
//
// Routes:
//
//   GET /api/agentcy/brands
//     200 → { brands: Array<{ id, name }> }
//     The list is sorted by id for deterministic UI ordering.
//
//   GET /api/agentcy/brands/:id
//     200 → BrandProfile JSON
//     404 → if no brand.md exists for the id
//
// Write (PUT) is intentionally deferred to E3.3.c so the brand-loader
// serializer can land in its own commit with parity tests.

import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Express, Request, Response } from 'express'

import { BrandLoaderError, loadBrandProfile } from '@mh/brand-loader'

import type { AgentcyEngineLocation } from './types.js'

export interface RegisterBrandRoutesOptions {
  engine: AgentcyEngineLocation
}

function brandsRoot(engine: AgentcyEngineLocation): string {
  return join(engine.engineRoot, 'brands')
}

function listBrandDirs(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw err
  }
  const out: string[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = join(root, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    // Only count dirs that actually contain a brand.md; otherwise
    // unrelated subfolders (e.g. .DS_Store metadata, shared assets)
    // would surface as fake brands.
    let hasBrand = false
    try {
      hasBrand = statSync(join(full, 'brand.md')).isFile()
    } catch {
      hasBrand = false
    }
    if (hasBrand) out.push(basename(name))
  }
  out.sort()
  return out
}

export function registerAgentcyBrandRoutes(app: Express, opts: RegisterBrandRoutesOptions): void {
  app.get('/api/agentcy/brands', (_req: Request, res: Response) => {
    const root = brandsRoot(opts.engine)
    const ids = listBrandDirs(root)
    const brands: Array<{ id: string; name: string }> = []
    for (const id of ids) {
      try {
        const profile = loadBrandProfile(join(root, id))
        brands.push({ id, name: (profile.name as string) ?? id })
      } catch {
        // Skip brand dirs whose brand.md is malformed — the list
        // endpoint should never 500 just because one brand has a
        // typo in its frontmatter. The detail endpoint will return
        // a 422 for that id when the user tries to open it.
      }
    }
    res.json({ brands })
  })

  app.get('/api/agentcy/brands/:id', (req: Request, res: Response) => {
    const id = (req.params as Record<string, string | undefined>).id
    if (!id || /[\\/.]/.test(id)) {
      res.status(400).json({ error: 'invalid brand id' })
      return
    }
    const brandDir = join(brandsRoot(opts.engine), id)
    try {
      const profile = loadBrandProfile(brandDir)
      res.json(profile)
    } catch (err) {
      if (err instanceof BrandLoaderError) {
        // Distinguish "no such brand" from "brand exists but is
        // malformed" — gives the future BrandEditor UI a clear
        // signal to surface either an empty state or an error
        // banner.
        if (err.message.includes('not found')) {
          res.status(404).json({ error: 'brand not found' })
          return
        }
        res.status(422).json({ error: err.message })
        return
      }
      throw err
    }
  })
}
