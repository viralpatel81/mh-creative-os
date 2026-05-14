"""mh2-creative-studio legacy brand format reader + migrator.

mh2 stores brand data as `data/brand.json` with a camelCase BrandDna object
plus a top-level personas array. This module reads that file and emits the
canonical snake_case profile, optionally writing it back as a brand.md
frontmatter document.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from .loader import BrandLoaderError


# camelCase -> snake_case for legacy mh2 keys. Only keys we know map to a
# canonical field are translated; unknown keys are dropped so we don't
# pollute the canonical schema.
_FIELD_MAP: dict[str, str] = {
    "name": "name",
    "url": "url",
    "description": "description",
    "category": "category",
    "brandSummary": "brand_summary",
    "colors": "colors",
    "fonts": "fonts",
    "voiceTone": "voice_tone_legacy",  # parked; agentcy uses voice.tone
    "voiceAdjectives": "voice_adjectives",
    "targetAudience": "target_audience",
    "keyBenefits": "key_benefits",
    "usps": "usps",
    "featuresAndBenefits": "features_and_benefits",
    "brandGuidelinesAnalysis": "brand_guidelines_analysis",
    "photographyDirection": "photography_direction",
    "packagingDetails": "packaging_details",
    "adCreativeStyle": "ad_creative_style",
    "promptModifier": "prompt_modifier",
    "backgroundColors": "background_colors",
    "ctaStyle": "cta_style",
    "competitiveDifferentiation": "competitive_differentiation",
    "guarantee": "guarantee",
    "productType": "product_type",
    "socialProof": "social_proof",
}

# Nested camelCase -> snake_case mappings for known object-valued fields.
_NESTED_FIELD_MAP: dict[str, dict[str, str]] = {
    "photography_direction": {
        "lighting": "lighting",
        "colorGrading": "color_grading",
        "composition": "composition",
        "subjectMatter": "subject_matter",
        "propsAndSurfaces": "props_and_surfaces",
        "mood": "mood",
    },
    "packaging_details": {
        "physicalDescription": "physical_description",
        "labelLogoPlacement": "label_logo_placement",
        "distinctiveFeatures": "distinctive_features",
    },
    "ad_creative_style": {
        "typicalFormats": "typical_formats",
        "textOverlayStyle": "text_overlay_style",
        "photoVsIllustration": "photo_vs_illustration",
        "ugcUsage": "ugc_usage",
        "offerPresentation": "offer_presentation",
    },
}

_PERSONA_FIELDS: dict[str, str] = {
    "id": "id",
    "name": "name",
    "age": "age",
    "description": "description",
    "painPoints": "pain_points",
    "motivations": "motivations",
}


def _slugify(name: str) -> str:
    """Convert a brand name to a kebab-case slug for use as a brand id."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return slug or "brand"


def load_legacy_brand_json(path: str | Path, brand_id: str | None = None) -> dict[str, Any]:
    """Read mh2 brand.json and return a canonical brand profile dict.

    If `brand_id` is omitted, it's derived by slugifying brandDna.name. The
    caller can override (e.g., to match an existing folder name).
    """
    text = Path(path).read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BrandLoaderError(f"invalid brand.json: {exc}") from exc

    dna = data.get("brandDna")
    if not isinstance(dna, dict):
        raise BrandLoaderError("brand.json missing top-level `brandDna` object")

    name = dna.get("name")
    if not isinstance(name, str) or not name.strip():
        raise BrandLoaderError("brand.json brandDna.name must be a non-empty string")

    result: dict[str, Any] = {
        "id": brand_id or _slugify(name),
        "name": name,
    }

    for legacy_key, canonical_key in _FIELD_MAP.items():
        if legacy_key not in dna:
            continue
        value = dna[legacy_key]
        if canonical_key in _NESTED_FIELD_MAP and isinstance(value, dict):
            nested = _NESTED_FIELD_MAP[canonical_key]
            renamed: dict[str, Any] = {}
            for inner_legacy, inner_canonical in nested.items():
                if inner_legacy in value:
                    renamed[inner_canonical] = value[inner_legacy]
            result[canonical_key] = renamed
        else:
            result[canonical_key] = value

    personas_raw = data.get("personas")
    if isinstance(personas_raw, list):
        personas: list[dict[str, Any]] = []
        for p in personas_raw:
            if not isinstance(p, dict):
                continue
            mapped: dict[str, Any] = {}
            for legacy_key, canonical_key in _PERSONA_FIELDS.items():
                if legacy_key in p:
                    mapped[canonical_key] = p[legacy_key]
            if "id" in mapped:
                personas.append(mapped)
        if personas:
            result["personas"] = personas

    return result


def migrate_legacy_brand_json(
    source: str | Path,
    target_dir: str | Path,
    brand_id: str | None = None,
) -> Path:
    """Read mh2 brand.json from `source` and write a canonical brand.md to
    `target_dir/brand.md`. Returns the path of the file written.
    """
    profile = load_legacy_brand_json(source, brand_id=brand_id)
    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)
    out = target / "brand.md"
    body = yaml.safe_dump(profile, sort_keys=False, allow_unicode=True)
    out.write_text(f"---\n{body}---\n", encoding="utf-8")
    return out
