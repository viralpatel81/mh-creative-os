"""Subprocess entry point used by the TS parity test runner.

Reads a brand directory path from argv, loads via brand_loader, and prints
the normalized JSON to stdout for the TS side to compare.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure the sibling python package is importable without an install step.
ROOT = Path(__file__).resolve().parents[1] / "python"
sys.path.insert(0, str(ROOT))

from brand_loader import load_brand_profile  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python_runner.py <brand-dir>", file=sys.stderr)
        return 2
    profile = load_brand_profile(sys.argv[1])
    json.dump(profile, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
