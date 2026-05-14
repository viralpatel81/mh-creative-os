"""Brand profile loader — YAML frontmatter from brand.md."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml


class BrandLoaderError(Exception):
    """Raised when a brand.md file is malformed or missing required fields."""


# Frontmatter pattern: opening `---` on its own line, body, closing `---` on
# its own line. Tolerant of trailing whitespace on the delimiter lines.
_FRONTMATTER_RE = re.compile(
    r"^---\s*\n(?P<frontmatter>.*?)\n---\s*\n?(?P<body>.*)$",
    re.DOTALL,
)


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a brand.md document into frontmatter dict and body string.

    Returns ({}, original_text) when no frontmatter is present so callers
    can fall back gracefully on partial files.
    """
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    raw = match.group("frontmatter")
    body = match.group("body") or ""
    try:
        parsed = yaml.safe_load(raw) or {}
    except yaml.YAMLError as exc:
        raise BrandLoaderError(f"invalid YAML frontmatter: {exc}") from exc
    if not isinstance(parsed, dict):
        raise BrandLoaderError("brand.md frontmatter must be a YAML mapping")
    return parsed, body


def load_brand_profile_from_text(text: str) -> dict[str, Any]:
    """Parse brand.md content (frontmatter + body) into a normalized profile."""
    frontmatter, _body = parse_frontmatter(text)
    if "id" not in frontmatter:
        raise BrandLoaderError("brand profile missing required field: id")
    if "name" not in frontmatter:
        raise BrandLoaderError("brand profile missing required field: name")
    return _normalize(frontmatter)


def load_brand_profile(brand_dir: str | Path) -> dict[str, Any]:
    """Load brand.md from `brand_dir/brand.md` and return the normalized profile."""
    path = Path(brand_dir) / "brand.md"
    if not path.exists():
        raise BrandLoaderError(f"brand.md not found at {path}")
    return load_brand_profile_from_text(path.read_text(encoding="utf-8"))


def _normalize(raw: dict[str, Any]) -> dict[str, Any]:
    """Return the parsed YAML as-is — YAML preserves key order and values,
    and the canonical schema uses snake_case which matches frontmatter
    conventions. Any future shape normalization (e.g., trimming, defaulting)
    lands here.
    """
    return dict(raw)
