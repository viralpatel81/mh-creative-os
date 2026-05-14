// Unified brand profile loader (TypeScript). Companion to the Python
// loader in ../../python/brand_loader/. Both implementations parse the
// same brand.md frontmatter and emit byte-identical normalized JSON
// against ../tests/fixtures/.

export type { BrandProfile, Persona } from './types.js'
export {
  BrandLoaderError,
  loadBrandProfile,
  loadBrandProfileFromText,
  parseFrontmatter,
  serializeBrandProfile,
} from './loader.js'
export { loadLegacyBrandJson, migrateLegacyBrandJson } from './legacy.js'
