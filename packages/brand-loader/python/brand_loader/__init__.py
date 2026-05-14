"""Unified brand profile loader (Python).

Reads brands/<id>/brand.md (YAML frontmatter) and emits a normalized dict
matching schema/brand_profile.v2.json. Companion to the TypeScript loader
in ../ts/src/; both implementations are kept byte-identical against the
fixtures in ../tests/fixtures/ so agentcy (Python) and the studio runtime
(TypeScript) agree on the brand model.

The mh2 legacy format (data/brand.json with camelCase) is read via
load_legacy_brand_json(); use migrate_legacy_brand_json() to write a
canonical brand.md from it.
"""

from .loader import (
    BrandLoaderError,
    load_brand_profile,
    load_brand_profile_from_text,
    parse_frontmatter,
)
from .legacy import load_legacy_brand_json, migrate_legacy_brand_json

__all__ = [
    "BrandLoaderError",
    "load_brand_profile",
    "load_brand_profile_from_text",
    "parse_frontmatter",
    "load_legacy_brand_json",
    "migrate_legacy_brand_json",
]
