"""One-shot migration CLI: mh2 brand.json -> canonical brand.md.

Usage:
    python -m brand_loader migrate <source-brand.json> <target-dir> [--id <brand-id>]

Prints the path of the written brand.md on success.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .legacy import migrate_legacy_brand_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m brand_loader",
        description="Brand loader utilities.",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    migrate = sub.add_parser("migrate", help="Migrate mh2 brand.json to canonical brand.md")
    migrate.add_argument("source", type=Path, help="Path to mh2 brand.json")
    migrate.add_argument(
        "target_dir",
        type=Path,
        help="Output directory (will be created if missing); brand.md is written inside",
    )
    migrate.add_argument(
        "--id",
        dest="brand_id",
        default=None,
        help="Override brand id (default: slugified from brandDna.name)",
    )

    args = parser.parse_args(argv)
    if args.cmd == "migrate":
        out = migrate_legacy_brand_json(args.source, args.target_dir, brand_id=args.brand_id)
        print(out)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
