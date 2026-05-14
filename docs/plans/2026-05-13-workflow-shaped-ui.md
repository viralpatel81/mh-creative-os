# E3.3 — Workflow-shaped UI plan

> Companion to architecture plan v5 (`~/.claude/plans/explore-mh2-creative-studio-and-agentcy-wiggly-acorn.md`). This document covers the per-workflow form UI, /runs dashboard, brand editor mh2 extension, and the routing/transport seams they need. Survey done 2026-05-13 against fork commit `08ea81ba` (mh-creative-os).

## Survey findings

1. **`apps/web` is a SPA, not file-system routed.** The Next.js layer mounts a single `[[...slug]]` catch-all that dynamic-imports `src/App.tsx`. Internal routing lives in `src/router.ts` as a discriminated union:

   ```ts
   export type Route =
     | { kind: 'home' }
     | { kind: 'project'; projectId: string; fileName: string | null }
   ```

   E3.3 must extend this union (and `parseRoute` / `buildPath` / `navigate` callers). It cannot create `app/runs/page.tsx` files — the plan's earlier wording about that was carry-over from a different open-design vintage.

2. **No existing `BrandEditor.tsx`.** open-design has design-system editing (kami, default), not brand-profile editing. The plan's "extend OD's project settings" framing doesn't match what's in the repo.

3. **No daemon endpoint for `brands/<id>/brand.md`.** `@mh/brand-loader` (TS) is Node-only (uses `fs`); the browser cannot reach `brand.md` without a daemon round-trip. The daemon endpoint is a prerequisite for any web UI on top.

4. **`brands/` directory doesn't exist in this fork.** Engine historically reads from `apps/engine/brands/...`. We must pick a canonical path and have the daemon honor it. Recommended: keep `apps/engine/brands/` as the source of truth (engine subprocess is the heavy reader); daemon reads via `@mh/brand-loader` rooted on `<engineRoot>/brands/`.

5. **Workflow run shell already exists.** `POST /api/agentcy/runs/workflow` (E3.1+E2) + `GET /api/agentcy/runs/:runId` + SSE all work. So the /runs dashboard is mostly a thin client over those.

## Subtask breakdown

E3.3 ships as a chain of independent commits. Each must be green on its own.

### E3.3.a — Daemon brand-profile read endpoint

**Goal:** GET `/api/agentcy/brands` + `/api/agentcy/brands/:id` backed by `@mh/brand-loader`. Read-only first; write moves to E3.3.c so the brand-loader change can land in its own commit.

- New `apps/daemon/src/agentcy/brand-routes.ts` (no upstream files touched → no Apache header needed).
- Routes:
  - `GET /api/agentcy/brands` → list brand ids (from `<engineRoot>/brands/*/brand.md`).
  - `GET /api/agentcy/brands/:id` → full BrandProfile JSON.
  - 404 if id doesn't resolve to a real folder.
- Wire into `registerAgentcyRoutes` (it already takes `engine: AgentcyEngineLocation` which has `engineRoot`).
- Tests under `apps/daemon/tests/agentcy/brand-routes.test.ts`. Fixture a tmp brands dir, exercise list + get + 404.

**Out of scope here:** writes, UI, brand selector, brand creation flow. The endpoint is enough on its own to verify with curl.

### E3.3.b — Brand editor component (read-only first)

**Goal:** `apps/web/src/components/BrandEditor.tsx`. Fetches via `/api/agentcy/brands/:id`, renders the mh2 extension fields in a tabbed UI, no edit affordance yet.

- Tabs: **Identity** (name/positioning/url/description), **Voice** (tone/style/do/don't/voice_adjectives), **Visual** (photography_direction nested fields, packaging_details, ad_creative_style), **Audience** (audiences, personas with nested edit), **Offers** (offers + proof_points + social_proof), **Channels** (channels + pillars + formats).
- Read-only: every field renders as `<dl>` rows, not inputs. Editing comes in E3.3.c — splitting the concerns keeps each commit small.
- New `Route` kind: `{ kind: 'brand'; brandId: string }`, URL `/brands/:id`.
- A "Brand" link in `EntryView` lists available brands (calls `GET /api/agentcy/brands`).
- Tests under `apps/web/tests/components/BrandEditor.test.ts` — mock the fetch, assert all six tabs render with their expected fields.

### E3.3.c — Brand editor write affordance

**Goal:** turn read-only fields into controlled inputs + a Save button that calls `PUT /api/agentcy/brands/:id`.

- Local form state mirrors fetched profile.
- Dirty tracking + "Discard changes" affordance.
- Optimistic save → revalidate on 200; surface errors inline.
- Tests: state transitions (dirty → saved → clean), error rollback.

### E3.3.d — /runs dashboard

**Goal:** `apps/web/src/components/runs/RunsDashboard.tsx` lists recent runs from `/api/agentcy/runs`. (No such list endpoint yet → add `GET /api/agentcy/runs?status=...&limit=...`.)

- New route: `{ kind: 'runs' }` → `/runs`.
- Columns: runId (linked), workflow, brandId, status badge, startedAt, durationMs.
- Filters: status (running/succeeded/failed), workflow.
- Auto-refresh every 10s while any row is in `running`.

### E3.3.e — /runs/:runId detail

**Goal:** `apps/web/src/components/runs/RunDetail.tsx`. Subscribes to SSE event stream, renders artifact cards (using ImageRenderer from E3.2) + a chronological event timeline.

- Route: `{ kind: 'run'; runId: string }` → `/runs/:runId`.
- Re-uses the existing artifact-parser + renderer-registry.

### E3.3.f — Request forms

**Goal:** `apps/web/src/components/runs/AdRequestForm.tsx`, `EmailRequestForm.tsx`, `PopupRequestForm.tsx`. Each posts a `WorkflowRunRequest` to `/api/agentcy/runs/workflow` and navigates to the detail view.

- Route: `{ kind: 'runs-new'; workflow: 'ad.post' | 'email.design' | 'popup.design' }` → `/runs/new/:workflow`.
- Brand picker (calls `GET /api/agentcy/brands`).
- Fields per workflow follow `packages/protocols/schemas/{ad,email,popup}_request.v1.json`.
- Submit → 202 → route to `/runs/<returned runId>`.

### E3.3.g — Brand editor → Run launch glue

**Goal:** "Launch ad workflow for this brand" button on the BrandEditor, deep-links to `/runs/new/ad.post?brand=<id>`.

## Open decisions to make during execution

1. **Whether E3.3 uses open-design's discovery questionnaire framework or builds dedicated forms.** Plan v5 deferred this; survey confirms the framework is chat-shaped (`packages/contracts/src/prompts/discovery.ts` returns scripts the agent steps through). The four request schemas are small enough that dedicated forms are simpler and we should go dedicated. Revisit if the field count grows.

2. **Brand directory canonical path.** Recommendation: `apps/engine/brands/<id>/` continues to be source of truth. Daemon reads via `<engineRoot>/brands/`. Documented in NOTICE-style if we ever change it.

3. **Auth / multi-user.** open-design assumes a single local user. We're not changing that. Brand editing is unauthenticated within the daemon.

## Apache compliance

E3.3.a touches NO upstream files (new file under `apps/daemon/src/agentcy/`, our namespace). No change-notice needed.

E3.3.b adds new files but also needs an `EntryView` modification to surface the Brand link — that's an upstream file, header required.

E3.3.d / .e / .f / .g add new files and require modifications to `src/router.ts` (upstream) and `EntryView.tsx` (upstream) — headers required.
