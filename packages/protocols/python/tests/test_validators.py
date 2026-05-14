"""Schema validation tests — cover the happy path and key failure modes
for each contract. The schemas themselves are JSON Schema draft-07; these
tests guarantee the engine fails closed on malformed input.
"""

from __future__ import annotations

import pytest

from mh_protocols import (
    ProtocolValidationError,
    validate_ad_request_v1,
    validate_email_request_v1,
    validate_popup_request_v1,
    validate_run_result_v1_extensions,
)


# ---- ad_request.v1 -----------------------------------------------------------


def test_ad_request_minimal_valid() -> None:
    validate_ad_request_v1(
        {
            "brand_id": "givecare",
            "aspects": ["1:1"],
            "engine": "gemini",
            "layout_mode": "strategy",
        }
    )


def test_ad_request_full_valid() -> None:
    validate_ad_request_v1(
        {
            "schema_version": "ad_request.v1",
            "brand_id": "givecare",
            "brief_text": "Launch our new caregiver tooling.",
            "aspects": ["1:1", "3:4", "9:16"],
            "engine": "openai",
            "model_tier": "hd",
            "layout_mode": "template",
            "vault_refs": ["t-001", "t-042"],
            "asset_ids": ["asset-1"],
            "quantity": 3,
            "purpose": "launch",
            "custom_description": "Match autumn palette.",
        }
    )


def test_ad_request_rejects_unknown_aspect() -> None:
    with pytest.raises(ProtocolValidationError):
        validate_ad_request_v1(
            {"brand_id": "x", "aspects": ["16:9"], "engine": "gemini", "layout_mode": "strategy"}
        )


def test_ad_request_rejects_extra_top_level() -> None:
    with pytest.raises(ProtocolValidationError):
        validate_ad_request_v1(
            {
                "brand_id": "x",
                "aspects": ["1:1"],
                "engine": "gemini",
                "layout_mode": "strategy",
                "rogue": True,
            }
        )


def test_ad_request_rejects_missing_required() -> None:
    with pytest.raises(ProtocolValidationError):
        validate_ad_request_v1({"brand_id": "x", "aspects": ["1:1"], "engine": "gemini"})


def test_ad_request_rejects_empty_aspects() -> None:
    with pytest.raises(ProtocolValidationError):
        validate_ad_request_v1(
            {"brand_id": "x", "aspects": [], "engine": "gemini", "layout_mode": "strategy"}
        )


# ---- email_request.v1 --------------------------------------------------------


def test_email_request_minimal_valid() -> None:
    validate_email_request_v1(
        {
            "brand_id": "givecare",
            "aspects": ["3:4"],
            "engine": "gemini",
            "purpose": "welcome",
        }
    )


def test_email_request_rejects_invalid_purpose() -> None:
    with pytest.raises(ProtocolValidationError):
        validate_email_request_v1(
            {
                "brand_id": "x",
                "aspects": ["3:4"],
                "engine": "gemini",
                "purpose": "not-a-real-purpose",
            }
        )


def test_email_request_rejects_ad_aspect_ratio() -> None:
    # 1:1 is valid for ads but not for emails (tall ratios only).
    with pytest.raises(ProtocolValidationError):
        validate_email_request_v1(
            {"brand_id": "x", "aspects": ["1:1"], "engine": "gemini", "purpose": "welcome"}
        )


# ---- popup_request.v1 --------------------------------------------------------


def test_popup_request_minimal_valid() -> None:
    validate_popup_request_v1(
        {
            "brand_id": "givecare",
            "aspects": ["1:1"],
            "engine": "openai",
            "purpose": "email-capture",
        }
    )


def test_popup_request_rejects_email_purpose() -> None:
    # An email purpose like 'welcome' must not satisfy popup_request.
    with pytest.raises(ProtocolValidationError):
        validate_popup_request_v1(
            {
                "brand_id": "x",
                "aspects": ["1:1"],
                "engine": "gemini",
                "purpose": "welcome",
            }
        )


# ---- run_result.v1.extensions ------------------------------------------------


def test_run_result_ad_output_minimal_valid() -> None:
    validate_run_result_v1_extensions(
        {
            "ad_output": {
                "images": [{"aspect": "1:1", "path": "state/artifacts/run_x/ad.png"}]
            }
        }
    )


def test_run_result_email_output_valid() -> None:
    validate_run_result_v1_extensions(
        {
            "email_output": {
                "purpose": "welcome",
                "images": [{"aspect": "3:4", "path": "state/artifacts/run_y/email.png"}],
            }
        }
    )


def test_run_result_rejects_unknown_image_field() -> None:
    with pytest.raises(ProtocolValidationError):
        validate_run_result_v1_extensions(
            {
                "ad_output": {
                    "images": [{"aspect": "1:1", "path": "p.png", "rogue": "field"}]
                }
            }
        )


def test_run_result_accepts_engine_stub_ad_payload() -> None:
    """Lock the contract between the engine's Phase C ad.post stub and the
    schema. If the stub shape changes in a way that breaks the schema, this
    test fails before any downstream consumer sees the drift.
    """
    validate_run_result_v1_extensions(
        {
            "ad_output": {
                "stub": True,
                "brand": "givecare",
                "images": [
                    {
                        "aspect": "1:1",
                        "path": "state/artifacts/run_x/stub-ad-1x1.png",
                        "engine": "gemini",
                    }
                ],
            }
        }
    )


def test_run_result_accepts_engine_stub_email_payload() -> None:
    validate_run_result_v1_extensions(
        {
            "email_output": {
                "stub": True,
                "brand": "givecare",
                "purpose": "welcome",
                "images": [
                    {
                        "aspect": "3:4",
                        "path": "state/artifacts/run_x/stub-email-3x4.png",
                        "engine": "gemini",
                    }
                ],
            }
        }
    )


def test_run_result_accepts_engine_stub_popup_payload() -> None:
    validate_run_result_v1_extensions(
        {
            "popup_output": {
                "stub": True,
                "brand": "givecare",
                "purpose": "email-capture",
                "images": [
                    {
                        "aspect": "1:1",
                        "path": "state/artifacts/run_x/stub-popup-1x1.png",
                        "engine": "openai",
                    }
                ],
            }
        }
    )
