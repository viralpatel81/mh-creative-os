---
id: full-coverage
name: Full Coverage Test Brand
positioning: A synthetic fixture exercising every schema field.
url: https://example.com
description: Synthetic brand for parity tests.
category: Test Category
brand_summary: A brand that exists only to validate the loader.

audiences:
  - id: testers
    summary: Engineers verifying loader parity.

offers:
  - id: docs
    summary: Documentation.
    url: https://example.com/docs
    cta: Read the docs

proof_points:
  - Tests exist.
  - Parity holds.

pillars:
  - id: durability
    perspective: Storage survives crashes.
    signals: [outbox, recovery, wal]
    format: data-driven
    frequency: weekly
    default_format: infographic

voice:
  tone: Precise.
  style: Terse.
  do:
    - Use small words.
  dont:
    - Editorialize.

channels:
  social:
    objective: Smoke-test channels.
    platforms: [twitter]
    default_offer: docs

formats:
  - id: standard
    description: default format

colors: ["#000000", "#FFFFFF"]
fonts: ["Inter [body]"]
voice_adjectives: ["Precise", "Terse"]
target_audience: Engineers running tests.
key_benefits:
  - Loader works
  - Tests pass
usps:
  - Synthetic but complete.
features_and_benefits: Inline string field.
brand_guidelines_analysis: Stub analysis.

photography_direction:
  lighting: Flat.
  color_grading: Neutral.
  composition: Centered.
  subject_matter: A single token product.
  props_and_surfaces: None.
  mood: Sterile.

packaging_details:
  physical_description: A box.
  label_logo_placement: Top left.
  distinctive_features: None.

ad_creative_style:
  typical_formats: Static.
  text_overlay_style: None.
  photo_vs_illustration: Photo.
  ugc_usage: None.
  offer_presentation: Direct.

prompt_modifier: Render in a sterile test environment.
background_colors: ["#FFFFFF"]
cta_style: Plain text link.
competitive_differentiation: It exists.
guarantee: No promises.
product_type: Test artifact.
social_proof: {}

personas:
  - id: tester
    name: Tess Engineer
    age: "30"
    description: Runs the test suite.
    pain_points:
      - Flaky tests
    motivations:
      - Green CI
---

Body text is ignored by the loader's frontmatter parser but preserved verbatim
in any future caller that needs it.
