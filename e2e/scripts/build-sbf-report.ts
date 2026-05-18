// Build a self-contained HTML report of the SBF generation walkthrough.
//
// Walks every daemon runId in sbf-run-log.md, maps it to the engine's
// internal runId via the JSONL log file the daemon recorded, then
// inlines every artifact under apps/engine/state/artifacts/run_<id>/:
//   - PNGs as base64 data URIs
//   - JSON files as syntax-highlighted blocks (truncated to a budget)
//
// The output uses the Shepherd Boy Farms design system (palette +
// typography from apps/engine/brands/shepherdboyfarms/design.md) so
// the report itself feels like an SBF deliverable.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// REPO_ROOT defaults to the worktree, but the actual engine state often
// lives under the main checkout (the running daemon writes there).
// Override via OD_AGENTCY_ROOT to point at a different apps/engine.
const REPO_ROOT = join(__dirname, '..', '..')
const ENGINE_ROOT =
  process.env.OD_AGENTCY_ROOT ??
  (() => {
    // Try worktree first, fall back to main checkout outside .claude/worktrees/
    const worktreeEngine = join(REPO_ROOT, 'apps', 'engine')
    const mainEngine = REPO_ROOT.includes('.claude/worktrees/')
      ? REPO_ROOT.replace(/\/\.claude\/worktrees\/[^/]+/, '')
      : worktreeEngine
    return join(mainEngine, 'apps', 'engine').replace(/apps\/engine\/apps\/engine$/, 'apps/engine')
  })()
const RUN_LOGS_DIR = join(ENGINE_ROOT, 'state', 'run-logs')
const ARTIFACTS_DIR = join(ENGINE_ROOT, 'state', 'artifacts')

interface RunRow {
  workflow: string
  daemonRunId: string
  status: string
  artifacts: number
  durationSec: string
}

interface ArtifactFile {
  name: string
  path: string
  sizeBytes: number
  ext: string
}

interface ResolvedRun extends RunRow {
  engineRunId: string | null
  events: Array<Record<string, unknown>>
  files: ArtifactFile[]
}

function parseRunLog(): RunRow[] {
  const md = readFileSync(join(__dirname, 'sbf-run-log.md'), 'utf8')
  const rows: RunRow[] = []
  for (const line of md.split('\n')) {
    const m = line.match(/^\| ([\w.]+) \| ([0-9a-f-]+) \| (\w+) \| (\d+) \| ([\d.]+)s \| /)
    if (m) {
      rows.push({
        workflow: m[1]!,
        daemonRunId: m[2]!,
        status: m[3]!,
        artifacts: Number(m[4]),
        durationSec: m[5]!,
      })
    }
  }
  return rows
}

function resolveEngineRunId(daemonRunId: string): { engineRunId: string | null; events: Array<Record<string, unknown>> } {
  const path = join(RUN_LOGS_DIR, `${daemonRunId}.jsonl`)
  const events: Array<Record<string, unknown>> = []
  let engineRunId: string | null = null
  try {
    const text = readFileSync(path, 'utf8')
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line.startsWith('{')) continue
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        events.push(parsed)
        if (!engineRunId && typeof parsed.runId === 'string' && parsed.runId.startsWith('run_')) {
          engineRunId = parsed.runId
        }
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* file might not exist for stub workflows where engine never spoke */
  }
  return { engineRunId, events }
}

function listArtifacts(engineRunId: string | null): ArtifactFile[] {
  if (!engineRunId) return []
  const dir = join(ARTIFACTS_DIR, engineRunId)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.map((name) => {
    const path = join(dir, name)
    const stat = statSync(path)
    return { name, path, sizeBytes: stat.size, ext: extname(name).toLowerCase() }
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}

function renderArtifact(file: ArtifactFile): string {
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(file.ext)) {
    const data = readFileSync(file.path).toString('base64')
    const mime =
      file.ext === '.jpg' || file.ext === '.jpeg'
        ? 'image/jpeg'
        : file.ext === '.webp'
          ? 'image/webp'
          : file.ext === '.gif'
            ? 'image/gif'
            : 'image/png'
    return `
<figure class="artifact artifact--image">
  <img alt="${escapeHtml(file.name)}" src="data:${mime};base64,${data}" />
  <figcaption>${escapeHtml(file.name)} · ${fmtBytes(file.sizeBytes)}</figcaption>
</figure>`
  }
  if (file.ext === '.json') {
    const raw = readFileSync(file.path, 'utf8')
    let pretty = raw
    try {
      pretty = JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      /* keep raw */
    }
    const cap = 4000
    const truncated = pretty.length > cap ? pretty.slice(0, cap) + `\n… (truncated, ${pretty.length - cap} chars omitted)` : pretty
    // Infer a friendly label from the JSON's top-level keys
    let label = file.name
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>
      if (typeof obj.kind === 'string') label = `${obj.kind}`
      else if (typeof obj.workflow === 'string' && typeof obj.channel === 'string') label = `${obj.workflow} / ${obj.channel}`
      else if (typeof obj.brand === 'string') label = `brief — ${obj.brand}`
    } catch {
      /* ignore */
    }
    return `
<details class="artifact artifact--json" ${file.sizeBytes < 1200 ? 'open' : ''}>
  <summary><span class="artifact__label">${escapeHtml(label)}</span> <span class="artifact__meta">${escapeHtml(file.name)} · ${fmtBytes(file.sizeBytes)}</span></summary>
  <pre><code>${escapeHtml(truncated)}</code></pre>
</details>`
  }
  return `<div class="artifact artifact--other">${escapeHtml(file.name)} · ${fmtBytes(file.sizeBytes)}</div>`
}

function renderTimeline(events: Array<Record<string, unknown>>): string {
  if (events.length === 0) return '<p class="empty">No events recorded.</p>'
  const items = events.map((ev) => {
    const kind = String(ev.kind || '')
    let summary = ''
    if (kind === 'step.start') summary = String(ev.step ?? '')
    else if (kind === 'step.end') summary = `${ev.step} · ${ev.durationMs}ms`
    else if (kind === 'log') summary = `[${ev.level}] ${ev.message}`
    else if (kind === 'artifact.written') summary = `${ev.type} ${ev.identifier ? '· ' + ev.identifier : ''}`
    else if (kind === 'run.failed') summary = `${ev.step}: ${ev.error}`
    else if (kind === 'end') summary = `status=${ev.status} exit=${ev.exitCode}`
    return `<li class="ev ev--${kind.replace('.', '-')}"><span class="ev__kind">${escapeHtml(kind)}</span><span class="ev__summary">${escapeHtml(summary)}</span></li>`
  })
  return `<ol class="timeline">${items.join('')}</ol>`
}

function renderRun(run: ResolvedRun): string {
  const heroImage = run.files.find((f) => f.name === 'instagram.png' || f.name === 'facebook.png' || f.name === 'linkedin.png' || f.ext === '.png')
  const images = run.files.filter((f) => ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(f.ext))
  const jsons = run.files.filter((f) => f.ext === '.json')
  const others = run.files.filter((f) => !['.png', '.jpg', '.jpeg', '.webp', '.gif', '.json'].includes(f.ext))
  return `
<section class="run">
  <header class="run__header">
    <div>
      <h2 class="run__title">${escapeHtml(run.workflow)}</h2>
      <p class="run__meta">
        <span class="badge badge--${run.status}">${run.status}</span>
        <span>· ${run.artifacts} artifacts</span>
        <span>· ${run.durationSec}s</span>
      </p>
      <p class="run__ids">
        <code>daemon ${run.daemonRunId}</code>${run.engineRunId ? ` → <code>${run.engineRunId}</code>` : ''}
      </p>
    </div>
    ${heroImage ? `<img class="run__hero" alt="${escapeHtml(heroImage.name)}" src="data:image/png;base64,${readFileSync(heroImage.path).toString('base64')}" />` : ''}
  </header>
  ${images.length > 0 ? `<div class="run__gallery">${images.map(renderArtifact).join('')}</div>` : ''}
  <details class="run__timeline">
    <summary>Timeline (${run.events.length} events)</summary>
    ${renderTimeline(run.events)}
  </details>
  ${jsons.length > 0 ? `<div class="run__json">${jsons.map(renderArtifact).join('')}</div>` : ''}
  ${others.length > 0 ? `<div class="run__other">${others.map(renderArtifact).join('')}</div>` : ''}
</section>`
}

function brandLogoDataUri(): string {
  const path = join(REPO_ROOT, 'apps', 'engine', 'brands', 'shepherdboyfarms', 'assets', 'logo.png')
  try {
    const data = readFileSync(path).toString('base64')
    return `data:image/png;base64,${data}`
  } catch {
    return ''
  }
}

function brandProfileSummary(): { name: string; positioning: string } {
  const path = join(REPO_ROOT, 'apps', 'engine', 'brands', 'shepherdboyfarms', 'brand.md')
  try {
    const text = readFileSync(path, 'utf8')
    const nameMatch = text.match(/^name: (.+)$/m)
    const posMatch = text.match(/^positioning: (.+)$/m)
    return {
      name: nameMatch ? nameMatch[1]!.trim() : 'Shepherd Boy Farms',
      positioning: posMatch ? posMatch[1]!.trim() : '',
    }
  } catch {
    return { name: 'Shepherd Boy Farms', positioning: '' }
  }
}

function buildHtml(runs: ResolvedRun[]): string {
  const { name, positioning } = brandProfileSummary()
  const logo = brandLogoDataUri()
  const succeeded = runs.filter((r) => r.status === 'succeeded').length
  const totalArtifacts = runs.reduce((n, r) => n + r.files.length, 0)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(name)} — generation walkthrough</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,wght@0,400;0,700;0,800;0,900&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #F7F2E8;
    --ink: #282828;
    --accent: #0B6659;
    --secondary: #325232;
    --highlight: #C97B2E;
    --paper: #FBF7EE;
    --rule: rgba(40, 40, 40, 0.12);
    --ink-soft: rgba(40, 40, 40, 0.62);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: "Nunito Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.5;
  }
  .page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 64px 32px;
  }
  .masthead {
    display: flex;
    align-items: center;
    gap: 24px;
    padding-bottom: 32px;
    border-bottom: 2px solid var(--ink);
    margin-bottom: 48px;
  }
  .masthead__logo {
    width: 88px;
    height: 88px;
    object-fit: contain;
    background: var(--ink);
    border-radius: 8px;
    padding: 8px;
  }
  .masthead__brand { font-weight: 800; font-size: 36px; letter-spacing: -0.01em; line-height: 1; }
  .masthead__kicker { font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; color: var(--accent); font-size: 12px; margin-bottom: 4px; }
  .masthead__positioning { color: var(--ink-soft); max-width: 56ch; margin-top: 8px; }
  .summary {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-left: 6px solid var(--accent);
    padding: 20px 24px;
    margin-bottom: 56px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
  .summary__stat { display: flex; flex-direction: column; gap: 2px; }
  .summary__num { font-weight: 800; font-size: 28px; line-height: 1; }
  .summary__label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-soft); }
  .run {
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 28px 32px;
    margin-bottom: 32px;
    border-radius: 4px;
  }
  .run__header {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    align-items: flex-start;
    margin-bottom: 20px;
  }
  .run__title { font-weight: 800; font-size: 28px; margin: 0 0 6px; letter-spacing: -0.01em; color: var(--ink); }
  .run__meta { margin: 0 0 6px; color: var(--ink-soft); font-size: 14px; }
  .run__ids { font-size: 11px; color: var(--ink-soft); margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .run__hero {
    width: 200px;
    height: 200px;
    object-fit: cover;
    border-radius: 4px;
    background: var(--ink);
  }
  .badge {
    display: inline-block;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--bg);
  }
  .badge--succeeded { background: var(--accent); }
  .badge--failed { background: #B23A2C; }
  .badge--running { background: var(--highlight); }
  .run__gallery {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .artifact--image {
    margin: 0;
    border: 1px solid var(--rule);
    background: var(--bg);
    padding: 8px;
  }
  .artifact--image img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: contain;
  }
  .artifact--image figcaption {
    font-size: 11px;
    color: var(--ink-soft);
    padding-top: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .run__json { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .artifact--json {
    border: 1px solid var(--rule);
    background: var(--bg);
    padding: 12px 14px;
    border-radius: 3px;
  }
  .artifact--json summary {
    cursor: pointer;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .artifact__label { color: var(--accent); }
  .artifact__meta { font-size: 11px; color: var(--ink-soft); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .artifact--json pre {
    margin: 12px 0 0;
    padding: 12px;
    background: var(--ink);
    color: #E8E2D6;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    overflow-x: auto;
    border-radius: 3px;
  }
  .artifact--other {
    background: var(--bg);
    border: 1px dashed var(--rule);
    padding: 8px 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
  .run__timeline { margin: 16px 0; }
  .run__timeline summary { cursor: pointer; font-weight: 700; color: var(--secondary); }
  .timeline { list-style: none; padding: 12px 0 0; margin: 0; }
  .ev { display: flex; gap: 12px; padding: 4px 0; border-bottom: 1px dashed var(--rule); font-size: 13px; }
  .ev:last-child { border-bottom: 0; }
  .ev__kind { width: 130px; flex-shrink: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--secondary); font-weight: 700; }
  .ev--artifact-written .ev__kind { color: var(--highlight); }
  .ev--run-failed .ev__kind { color: #B23A2C; }
  .ev--end .ev__kind { color: var(--accent); }
  .ev__summary { color: var(--ink-soft); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .empty { color: var(--ink-soft); font-style: italic; }
  code { background: var(--bg); padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--rule);
    color: var(--ink-soft);
    font-size: 12px;
    display: flex;
    justify-content: space-between;
  }
  @media (max-width: 640px) {
    .page { padding: 32px 16px; }
    .masthead { flex-direction: column; align-items: flex-start; }
    .summary { grid-template-columns: repeat(2, 1fr); }
    .run__header { grid-template-columns: 1fr; }
    .run__hero { width: 100%; height: auto; }
  }
</style>
</head>
<body>
<main class="page">
  <header class="masthead">
    ${logo ? `<img class="masthead__logo" alt="${escapeHtml(name)} logo" src="${logo}" />` : ''}
    <div>
      <p class="masthead__kicker">agentcy generation walkthrough</p>
      <h1 class="masthead__brand">${escapeHtml(name)}</h1>
      <p class="masthead__positioning">${escapeHtml(positioning)}</p>
    </div>
  </header>

  <section class="summary">
    <div class="summary__stat"><span class="summary__num">${succeeded} / ${runs.length}</span><span class="summary__label">Workflows succeeded</span></div>
    <div class="summary__stat"><span class="summary__num">${totalArtifacts}</span><span class="summary__label">Artifacts produced</span></div>
    <div class="summary__stat"><span class="summary__num">${runs.reduce((n, r) => n + r.files.filter(f => ['.png','.jpg','.jpeg','.webp'].includes(f.ext)).length, 0)}</span><span class="summary__label">Rendered images</span></div>
    <div class="summary__stat"><span class="summary__num">${runs.reduce((n, r) => n + r.events.length, 0)}</span><span class="summary__label">Engine events</span></div>
  </section>

  ${runs.map(renderRun).join('\n')}

  <footer>
    <span>Built ${new Date().toISOString()}</span>
    <span>mh-creative-os · phase E3 · brand=${escapeHtml(name)}</span>
  </footer>
</main>
</body>
</html>`
}

function main(): void {
  const rows = parseRunLog()
  const runs: ResolvedRun[] = rows.map((row) => {
    const { engineRunId, events } = resolveEngineRunId(row.daemonRunId)
    const files = listArtifacts(engineRunId)
    return { ...row, engineRunId, events, files }
  })
  const html = buildHtml(runs)
  const outPath = join(__dirname, 'sbf-report.html')
  writeFileSync(outPath, html, 'utf8')
  const sizeKb = (html.length / 1024).toFixed(0)
  console.log(`Wrote ${outPath} (${sizeKb}KB)`)
  console.log(
    `Sections: ${runs.length} · total files inlined: ${runs.reduce((n, r) => n + r.files.length, 0)}`,
  )
}

main()
