#!/usr/bin/env node
/**
 * Micro-Inversion Standard — session forensics analyzer (odai lesson:
 * reproducible, fingerprint-based evaluation). Dependency-free: reads the
 * extracted JSONL of a `session.export` (or a directory of .jsonl files) and
 * reports the evidence a real-session A/B needs:
 *
 *   - steps / turns / tool calls / compactions / assistant messages;
 *   - reasoning-block opener classification (bilingual) — the "we need"
 *     discipline rate (conform / violation / soft), first block per message;
 *   - anchor events (L2 near / L3 result / RE-ANCHOR / DRIFT) and trim
 *     markers (source.kind = micro-inversion-anchor / micro-inversion-trim);
 *   - request-surface facts (tool count / maxTokens per request/header);
 *   - token usage totals (input / output / cacheRead / reasoning) when the
 *     assistant messages carry usage.
 *
 * Usage:
 *   node scripts/analyze-session.mjs <session.jsonl> [more files or dirs...]
 *   node scripts/analyze-session.mjs --json <session.jsonl>
 *
 * A conforming run (stable discipline) is the ON-arm evidence; run the same
 * task WITHOUT the preset (built-in standard) as the OFF arm and compare
 * quality + tokens — never claim unconditional savings from one side.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { classifyOpener } from '../preset/anchor-sustainer.mjs'

const ANCHOR_KIND = 'micro-inversion-anchor'
const TRIM_KIND = 'micro-inversion-trim'

/** Collect .jsonl paths from files/dirs (recursive). */
function collect(paths) {
  const out = []
  const walk = (p) => {
    const st = statSync(p)
    if (st.isFile()) {
      if (extname(p).toLowerCase() === '.jsonl') out.push(p)
    } else if (st.isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry))
    }
  }
  for (const p of paths) walk(p)
  return out
}

function parseEvents(path) {
  const events = []
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue // tolerate a partial/foreign line
    }
    // Unwrap `{type, data}` or `{..., event: {type, data}}` shapes.
    if (event?.event && typeof event.event === 'object' && typeof event.event.type === 'string') {
      event = event.event
    }
    if (typeof event?.type === 'string') events.push(event)
  }
  return events
}

function analyze(events) {
  const stats = {
    steps: 0, turns: 0, toolCalls: 0, toolResults: 0, compactions: 0,
    assistantMessages: 0, reasoningBlocks: 0,
    openers: { conform: 0, violation: 0, soft: 0 },
    anchors: { near: 0, result: 0, reassert: 0, drift: 0, total: 0 },
    trims: 0,
    requests: { count: 0, tools: [], maxTokens: [] },
    usage: { input: 0, output: 0, cacheRead: 0, reasoning: 0, seen: false },
    violationsText: [],
  }
  for (const event of events) {
    const type = event.type
    if (type === 'step/start') stats.steps += 1
    else if (type === 'turn/start' || type === 'turn/end') stats.turns += 1
    else if (type === 'tool/call') stats.toolCalls += 1
    else if (type === 'tool/result') stats.toolResults += 1
    else if (type === 'compaction/start' || type === 'compaction/end') stats.compactions += 1
    else if (type === 'request/header') {
      stats.requests.count += 1
      const tools = event.data?.header?.tools ?? event.header?.tools
      if (Array.isArray(tools)) stats.requests.tools.push(tools.length)
      const maxTokens = event.data?.header?.config?.maxTokens ?? event.header?.config?.maxTokens
      if (typeof maxTokens === 'number') stats.requests.maxTokens.push(maxTokens)
    } else if (type === 'assistant/message') {
      stats.assistantMessages += 1
      const content = event.data?.message?.content ?? event.message?.content
      if (Array.isArray(content)) {
        const first = content.find(block => block?.type === 'reasoning' && typeof block.text === 'string')
        if (first !== undefined) {
          stats.reasoningBlocks += 1
          const label = classifyOpener(first.text)
          stats.openers[label] += 1
          if (label === 'violation') stats.violationsText.push(first.text.trim().slice(0, 90))
        }
      }
      const usage = event.data?.usage ?? event.data?.message?.usage ?? event.message?.usage
      if (usage && typeof usage === 'object') {
        stats.usage.seen = true
        for (const key of ['input', 'output', 'cacheRead', 'reasoning']) {
          if (typeof usage[key] === 'number') stats.usage[key] += usage[key]
        }
      }
    } else if (type === 'user/message') {
      const source = event.data?.message?.source ?? event.message?.source
      const kind = source?.kind
      const textBlocks = (event.data?.message?.content ?? event.message?.content ?? [])
        .filter(b => b?.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join(' ')
      if (kind === ANCHOR_KIND) {
        stats.anchors.total += 1
        if (textBlocks.includes('RE-ANCHOR')) stats.anchors.reassert += 1
        if (textBlocks.includes('DRIFT')) stats.anchors.drift += 1
        if (textBlocks.includes('result in hand')) stats.anchors.result += 1
        if (textBlocks.includes('open next block')) stats.anchors.near += 1
      } else if (kind === TRIM_KIND) {
        stats.trims += 1
      }
    }
  }
  return stats
}

function render(path, s) {
  const classified = s.openers.conform + s.openers.violation + s.openers.soft
  const conformRate = classified === 0 ? 0 : Math.round((s.openers.conform / classified) * 100)
  const tools = s.requests.tools.length > 0
    ? `${Math.min(...s.requests.tools)}…${Math.max(...s.requests.tools)} (${s.requests.tools.length} requests)`
    : 'n/a'
  const maxTokens = s.requests.maxTokens.length > 0
    ? `first=${s.requests.maxTokens[0] ?? 'n/a'}`
    : 'n/a'
  const lines = [
    `session: ${path}`,
    `  steps=${s.steps} turns=${s.turns} toolCalls=${s.toolCalls} toolResults=${s.toolResults} compactions=${s.compactions}`,
    `  assistantMessages=${s.assistantMessages} reasoningBlocks=${s.reasoningBlocks}`,
    `  openers: conform=${s.openers.conform} violation=${s.openers.violation} soft=${s.openers.soft} → we-need rate ${conformRate}%`,
    `  anchors: total=${s.anchors.total} (near=${s.anchors.near} result=${s.anchors.result} reassert=${s.anchors.reassert} drift=${s.anchors.drift})  trims=${s.trims}`,
    `  requests=${s.requests.count}  tools-per-request=${tools}  maxTokens: ${maxTokens}`,
    s.usage.seen
      ? `  usage: input=${s.usage.input} output=${s.usage.output} cacheRead=${s.usage.cacheRead} reasoning=${s.usage.reasoning}`
      : '  usage: not present in this export',
  ]
  if (s.violationsText.length > 0) {
    lines.push(`  violations: ${s.violationsText.map(t => `"${t}"`).join(' | ')}`)
  }
  return lines.join('\n')
}

const args = process.argv.slice(2)
const jsonFlag = args.includes('--json')
const paths = args.filter(a => a !== '--json')
if (paths.length === 0) {
  console.error('usage: node scripts/analyze-session.mjs [--json] <session.jsonl|dir> [...]')
  process.exit(2)
}
const files = collect(paths)
if (files.length === 0) {
  console.error(`no .jsonl files found under: ${paths.join(', ')}`)
  process.exit(2)
}
const results = files.map(path => ({ path, stats: analyze(parseEvents(path)) }))

if (jsonFlag) {
  console.log(JSON.stringify(results.map(r => ({ path: r.path, ...r.stats })), null, 2))
} else {
  for (const r of results) {
    console.log(render(r.path, r.stats))
    console.log('')
  }
}
