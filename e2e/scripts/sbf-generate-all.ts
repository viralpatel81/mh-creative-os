// SBF goal — Playwright-driven walkthrough of all 7 agentcy workflows
// for the shepherdboyfarms brand. Drives the live dev server (boots
// daemon + web via tools-dev or assumes they're already up).
//
// Mimics a real operator: navigate to the BrandEditor, click each
// Launch button in turn, fill the form, submit, wait for the run to
// land in /runs/:runId, then watch its status until terminal.
//
// Usage:
//   OD_PORT=56937 OD_WEB_PORT=56940 \
//     pnpm --filter @open-design/e2e exec tsx scripts/sbf-generate-all.ts
//
// The script writes a markdown summary to ./scripts/sbf-run-log.md.

import { chromium, type Browser, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const BRAND = 'shepherdboyfarms'
const DAEMON_PORT = Number(process.env.OD_PORT) || 56937
const WEB_PORT = Number(process.env.OD_WEB_PORT) || 56940
const WEB = `http://127.0.0.1:${WEB_PORT}`
const DAEMON = `http://127.0.0.1:${DAEMON_PORT}`

interface WorkflowSpec {
  workflow:
    | 'social.post'
    | 'blog.post'
    | 'outreach.touch'
    | 'respond.reply'
    | 'ad.post'
    | 'email.design'
    | 'popup.design'
  // Per-workflow seed values. The form's defaults handle the rest.
  topic?: string
  pillar?: string
  format?: string
  brief?: string
}

const WORKFLOWS: WorkflowSpec[] = [
  {
    workflow: 'social.post',
    topic: 'why freeze-dried beats kibble for allergy dogs',
    pillar: 'raw-vs-kibble',
    format: 'standard',
  },
  {
    workflow: 'blog.post',
    topic: 'a buyer guide for freeze-dried raw dog food',
    pillar: 'farm-to-bowl',
  },
  {
    workflow: 'outreach.touch',
    topic: 'introducing Shepherd Boy Farms to independent pet retailers',
  },
  {
    workflow: 'respond.reply',
    topic: 'reply to a customer asking about sodium content in beef hearts',
  },
  { workflow: 'ad.post', brief: 'kibble vs freeze-dried, family-farm tone' },
  { workflow: 'email.design', brief: 'welcome series first email — recipes overview' },
  { workflow: 'popup.design', brief: 'first-purchase 15% off via code GOAT15' },
]

interface RunResult {
  workflow: string
  runId: string | null
  status: 'succeeded' | 'failed' | 'canceled' | 'timeout' | 'launch-error'
  durationMs: number
  artifacts: number
  error: string | null
}

async function launchOneWorkflow(
  page: Page,
  spec: WorkflowSpec,
): Promise<RunResult> {
  const startedAt = Date.now()
  const log = (msg: string) => console.log(`[${spec.workflow}] ${msg}`)
  log('navigating to brand editor')
  await page.goto(`${WEB}/brands/${BRAND}`)
  await page.getByTestId(`brand-launch-${spec.workflow}`).waitFor({ timeout: 15_000 })
  log('clicking Launch button')
  await page.getByTestId(`brand-launch-${spec.workflow}`).click()

  // Wait until the form mounts. Native vs mh2 forms have different
  // first-visible fields — the Submit button is the universal anchor.
  await page.getByTestId('rf-submit').waitFor({ timeout: 15_000 })

  await fillIfPresent(page, 'rf-brief', spec.brief)
  await fillIfPresent(page, 'rf-topic', spec.topic)
  await fillIfPresent(page, 'rf-pillar', spec.pillar)
  await fillIfPresent(page, 'rf-format', spec.format)

  log('submitting form')
  await Promise.all([
    page.waitForURL(/\/runs\/[0-9a-f-]+$/, { timeout: 20_000 }),
    page.getByTestId('rf-submit').click(),
  ])
  const url = page.url()
  const runId = url.split('/').pop() ?? null
  if (!runId) {
    return {
      workflow: spec.workflow,
      runId: null,
      status: 'launch-error',
      durationMs: Date.now() - startedAt,
      artifacts: 0,
      error: 'no runId in URL after submit',
    }
  }
  log(`run launched: ${runId}`)

  const budgetMs = 4 * 60_000
  const pollIntervalMs = 1500
  const deadline = startedAt + budgetMs
  let finalStatus: RunResult['status'] = 'timeout'
  let error: string | null = null
  while (Date.now() < deadline) {
    const res = await fetch(`${DAEMON}/api/agentcy/runs/${runId}`)
    if (!res.ok) {
      await sleep(pollIntervalMs)
      continue
    }
    const body = (await res.json()) as {
      status: string
      errorMessage: string | null
    }
    if (body.status === 'succeeded' || body.status === 'failed' || body.status === 'canceled') {
      finalStatus = body.status as RunResult['status']
      error = body.errorMessage
      break
    }
    await sleep(pollIntervalMs)
  }

  let artifacts = 0
  try {
    const ev = await fetch(`${DAEMON}/api/agentcy/runs/${runId}/events`, {
      headers: { Accept: 'text/event-stream' },
    })
    if (ev.body) {
      const text = await ev.text()
      artifacts = (text.match(/^event: artifact\.written$/gm) || []).length
    }
  } catch {
    /* ignore */
  }

  log(`finished: status=${finalStatus} artifacts=${artifacts} duration=${Date.now() - startedAt}ms`)
  return {
    workflow: spec.workflow,
    runId,
    status: finalStatus,
    durationMs: Date.now() - startedAt,
    artifacts,
    error,
  }
}

async function fillIfPresent(page: Page, testId: string, value?: string): Promise<void> {
  if (!value) return
  const field = page.getByTestId(testId)
  if ((await field.count()) === 0) return
  await field.fill(value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const ping = await fetch(`${DAEMON}/api/agentcy/brands/${BRAND}`)
  if (!ping.ok) {
    throw new Error(
      `Daemon at ${DAEMON} not serving ${BRAND} — status ${ping.status}. Start with: pnpm tools-dev start web`,
    )
  }
  const ui = await fetch(WEB)
  if (!ui.ok) {
    throw new Error(`Web at ${WEB} not responding (status ${ui.status}).`)
  }
  console.log(`Driving ${WORKFLOWS.length} workflows for ${BRAND} via ${WEB}`)

  const browser: Browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  const results: RunResult[] = []
  for (const spec of WORKFLOWS) {
    try {
      const r = await launchOneWorkflow(page, spec)
      results.push(r)
    } catch (err) {
      results.push({
        workflow: spec.workflow,
        runId: null,
        status: 'launch-error',
        durationMs: 0,
        artifacts: 0,
        error: (err as Error).message,
      })
    }
  }

  await browser.close()

  const lines: string[] = []
  lines.push(`# SBF generation walkthrough — ${new Date().toISOString()}`)
  lines.push('')
  lines.push('| Workflow | runId | Status | Artifacts | Duration | Error |')
  lines.push('|---|---|---|---|---|---|')
  for (const r of results) {
    lines.push(
      `| ${r.workflow} | ${r.runId ?? '—'} | ${r.status} | ${r.artifacts} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.error ?? ''} |`,
    )
  }
  const succeeded = results.filter((r) => r.status === 'succeeded').length
  lines.push('')
  lines.push(`**${succeeded} / ${results.length} succeeded.**`)
  const summary = lines.join('\n')
  const outPath = join(__dirname, 'sbf-run-log.md')
  writeFileSync(outPath, summary, 'utf8')
  console.log('')
  console.log(summary)
  console.log(`\nWrote ${outPath}`)
  if (succeeded < results.length) process.exitCode = 1
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
