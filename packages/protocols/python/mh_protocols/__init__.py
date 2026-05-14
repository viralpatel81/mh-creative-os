"""mh-creative-os workflow protocol validators.

Wraps `jsonschema` with convenient `validate_*` functions that load the
authoritative schemas from `../../../schemas/`. Consumers (the engine
workflows, the daemon's workflow-run endpoint, the migration script)
import from here so a single schema source-of-truth governs all
runtime validation.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema

SCHEMAS_DIR = Path(__file__).resolve().parents[2] / "schemas"


class ProtocolValidationError(Exception):
    """Raised when a payload fails JSON Schema validation."""


@lru_cache(maxsize=None)
def _load_schema(name: str) -> dict[str, Any]:
    path = SCHEMAS_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"protocol schema not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _validate(name: str, payload: Any) -> None:
    schema = _load_schema(name)
    try:
        jsonschema.validate(payload, schema)
    except jsonschema.ValidationError as exc:
        raise ProtocolValidationError(f"{name} validation failed: {exc.message}") from exc


def validate_ad_request_v1(payload: Any) -> None:
    """Raise ProtocolValidationError if `payload` does not satisfy ad_request.v1."""
    _validate("ad_request.v1.json", payload)


def validate_email_request_v1(payload: Any) -> None:
    """Raise ProtocolValidationError if `payload` does not satisfy email_request.v1."""
    _validate("email_request.v1.json", payload)


def validate_popup_request_v1(payload: Any) -> None:
    """Raise ProtocolValidationError if `payload` does not satisfy popup_request.v1."""
    _validate("popup_request.v1.json", payload)


def validate_run_result_v1_extensions(payload: Any) -> None:
    """Raise ProtocolValidationError if `payload` does not satisfy run_result.v1.extensions.

    Only checks the workflow-specific output blocks (ad_output / email_output /
    popup_output); the base run_result.v1 contract is enforced by agentcy's
    existing schema in src/agentcy/protocols/schemas/.
    """
    _validate("run_result.v1.extensions.json", payload)


__all__ = [
    "ProtocolValidationError",
    "validate_ad_request_v1",
    "validate_email_request_v1",
    "validate_popup_request_v1",
    "validate_run_result_v1_extensions",
    "SCHEMAS_DIR",
]
