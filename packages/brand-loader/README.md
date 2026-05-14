# @mh/brand-loader

Unified brand profile loader. Single contract used by both the Python
agentcy modules and the TypeScript studio runtime, so a brand authored
once in `brands/<id>/brand.md` is consumed identically by both runtimes.

## Layout

```
brand-loader/
├── schema/
│   └── brand_profile.v2.json   ← authoritative schema (superset of agentcy + mh2 fields)
├── python/
│   └── brand_loader/           ← `pip install -e ./python` exposes the package
│       ├── loader.py           ← parse_frontmatter, load_brand_profile
│       └── legacy.py           ← read mh2 brand.json + migrate to brand.md
├── ts/
│   └── src/                    ← `@mh/brand-loader` (workspace package)
│       ├── loader.ts
│       ├── legacy.ts
│       └── types.ts
└── tests/
    ├── fixtures/full-coverage/ ← every-field fixture used by both languages
    └── python_runner.py        ← subprocess entry the TS parity test spawns
```

## Reading a canonical brand

Python:

```python
from brand_loader import load_brand_profile
profile = load_brand_profile("brands/givecare")
print(profile["name"], profile.get("voice", {}).get("tone"))
```

TypeScript:

```typescript
import { loadBrandProfile } from "@mh/brand-loader";
const profile = loadBrandProfile("brands/givecare");
console.log(profile.name, profile.voice?.tone);
```

Both return the same JSON shape against `tests/fixtures/full-coverage/expected.json`.

## Migrating an mh2 brand.json

CLI (one-shot):

```bash
python -m brand_loader migrate \
  /path/to/mh2-creative-studio/data/brand.json \
  brands/shepherdboyfarms \
  --id shepherdboyfarms
```

Library (Python):

```python
from brand_loader import migrate_legacy_brand_json
migrate_legacy_brand_json(
    "/path/to/data/brand.json",
    "brands/shepherdboyfarms",
    brand_id="shepherdboyfarms",
)
```

Library (TS):

```typescript
import { migrateLegacyBrandJson } from "@mh/brand-loader";
migrateLegacyBrandJson("/path/to/data/brand.json", "brands/shepherdboyfarms", "shepherdboyfarms");
```

camelCase fields (`brandSummary`, `voiceAdjectives`, `photographyDirection.colorGrading`, …) are mapped to canonical snake_case (`brand_summary`, `voice_adjectives`, `photography_direction.color_grading`, …). Personas are normalized similarly (`painPoints` → `pain_points`).

## Schema coverage

The canonical schema is a superset of:

- agentcy fields (`positioning`, `audiences`, `offers`, `pillars`, `voice`, `channels`, `formats`, `proof_points`)
- mh2 ad/email/popup extensions (`photography_direction`, `packaging_details`, `ad_creative_style`, `prompt_modifier`, `voice_adjectives`, `colors`, `fonts`, `target_audience`, `key_benefits`, `usps`, `personas`, …)

Every field except `id` and `name` is optional. Consumers read what they need; unknown frontmatter is preserved verbatim (`additionalProperties: true`).

## Parity testing

The TS parity test (`ts/tests/parity.test.ts`) loads each fixture in
both implementations and asserts deep-equal. Any field that loads
differently in the two languages = hard fail in CI before any consumer
sees the drift. See `tests/fixtures/full-coverage/` for the every-field
fixture; add more fixtures alongside it to expand coverage.

## Consumed by

- `apps/engine/src/agentcy/brand/core/brands.py` — Python `load_brand_config()` falls back to brand.md via this loader after trying brand.yml.
- (Phase D, future) `apps/engine/src/studio/runtime/src/workflows/{ad,email,popup}/` — wrapped mh2 generation pipelines will read brand.md via `@mh/brand-loader`.
