"""Python-side parity + behavior tests for the brand loader.

The cross-language parity test lives in the TS package (it spawns Python
via uv); these tests cover Python-only behavior like error paths and the
legacy migrator.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from brand_loader import (
    BrandLoaderError,
    load_brand_profile,
    load_brand_profile_from_text,
    load_legacy_brand_json,
    migrate_legacy_brand_json,
)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


def test_loads_full_coverage_fixture_matches_expected() -> None:
    profile = load_brand_profile(FIXTURES_DIR / "full-coverage")
    expected = json.loads((FIXTURES_DIR / "full-coverage" / "expected.json").read_text())
    assert profile == expected


def test_missing_id_raises() -> None:
    with pytest.raises(BrandLoaderError, match=r"required field: id"):
        load_brand_profile_from_text("---\nname: x\n---\n")


def test_missing_name_raises() -> None:
    with pytest.raises(BrandLoaderError, match=r"required field: name"):
        load_brand_profile_from_text("---\nid: x\n---\n")


def test_no_frontmatter_raises_on_missing_required_fields() -> None:
    with pytest.raises(BrandLoaderError):
        load_brand_profile_from_text("plain body, no frontmatter")


def test_invalid_yaml_raises() -> None:
    with pytest.raises(BrandLoaderError, match=r"invalid YAML"):
        load_brand_profile_from_text("---\nid: [unterminated\n---\n")


def test_frontmatter_must_be_mapping() -> None:
    with pytest.raises(BrandLoaderError, match=r"must be a YAML mapping"):
        load_brand_profile_from_text("---\n- 1\n- 2\n---\n")


def test_legacy_migrator_round_trip(tmp_path: Path) -> None:
    """mh2 brand.json -> canonical brand.md -> reload roundtrips cleanly."""
    src = tmp_path / "brand.json"
    src.write_text(
        json.dumps(
            {
                "brandDna": {
                    "name": "Round Trip Brand",
                    "url": "https://rt.example",
                    "brandSummary": "A migrated brand.",
                    "colors": ["#111", "#222"],
                    "voiceAdjectives": ["Direct"],
                    "photographyDirection": {
                        "lighting": "Soft.",
                        "colorGrading": "Warm.",
                    },
                    "packagingDetails": {
                        "physicalDescription": "Box.",
                    },
                },
                "personas": [
                    {
                        "id": "p1",
                        "name": "Alex",
                        "painPoints": ["expensive"],
                        "motivations": ["clarity"],
                    }
                ],
            }
        )
    )

    out = migrate_legacy_brand_json(src, tmp_path / "round-trip")
    assert out.exists()

    reloaded = load_brand_profile(tmp_path / "round-trip")
    assert reloaded["id"] == "round-trip-brand"
    assert reloaded["name"] == "Round Trip Brand"
    assert reloaded["url"] == "https://rt.example"
    assert reloaded["brand_summary"] == "A migrated brand."
    assert reloaded["colors"] == ["#111", "#222"]
    assert reloaded["voice_adjectives"] == ["Direct"]
    assert reloaded["photography_direction"] == {
        "lighting": "Soft.",
        "color_grading": "Warm.",
    }
    assert reloaded["packaging_details"] == {"physical_description": "Box."}
    assert reloaded["personas"] == [
        {
            "id": "p1",
            "name": "Alex",
            "pain_points": ["expensive"],
            "motivations": ["clarity"],
        }
    ]


def test_legacy_migrator_rejects_missing_name(tmp_path: Path) -> None:
    src = tmp_path / "bad.json"
    src.write_text(json.dumps({"brandDna": {}}))
    with pytest.raises(BrandLoaderError, match=r"non-empty string"):
        load_legacy_brand_json(src)


def test_legacy_migrator_rejects_missing_brand_dna(tmp_path: Path) -> None:
    src = tmp_path / "bad.json"
    src.write_text(json.dumps({"personas": []}))
    with pytest.raises(BrandLoaderError, match=r"brandDna"):
        load_legacy_brand_json(src)
