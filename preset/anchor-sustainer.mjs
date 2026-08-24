/**
 * Micro-Inversion Standard — global runtime anchors (v2).
 *
 * Turns the cold-start "we need" anchor into a GLOBAL runtime state with three
 * mechanisms (see docs/v2-global-micro-inversion.md):
 *
 * L2 — Near-field anchor (`agent/pre-step`, prepend): every model request gets
 *      a CONSTANT micro-anchor appended at the tail of `decision.messages`
 *      (the position of maximum attention). Persisted as a `user/message`
 *      event by the agent loop, so it also rides replay/resume.
 * L3 — Result anchor (`tools/post-execute`, prepend): every accepted tool
 *      result attaches a CONSTANT continue-anchor through
 *      `additionalContexts`, which the loop ferries into the next request —
 *      the harness-native "result → next request" channel, without mutating
 *      the result text or the durable log shape.
 * D  — Drift detection & re-anchoring: scans `session.events` incrementally
 *      (NEVER `session/event` — dsh-scope filters that event out of
 *      agent-plane presets, verified empirically) and classifies the opener of
 *      every reasoning block. Violations escalate the anchor wording, inject
 *      a re-assertion message, and at level >= 2 tighten the output budget and
 *      (when pressure allows) early-trim the middle of the request surface to
 *      restore head/tail salience. Recovery (>=3 consecutive conforming
 *      blocks) de-escalates.
 *
 * Composes with `tool-bootstrap.mjs` (phase-1 whitelist filter) and
 * `context-slimmer.mjs` (80% pressure trim + spill): both register prepend
 * listeners and are declared before this row in agent.cordis.yml, so they run
 * first and this plugin appends after their final decisions.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'micro-inversion-anchor-sustainer'

/** The `tools/post-execute` waterfall must exist before this listener runs. */
export const inject = ['tools']

/** Reuse the deterministic head/middle/tail surface split from the slimmer. */
import { splitSurface, measureMessageChars, routedTarget } from './context-slimmer.mjs?v=3'

/** Opener classifier: conforming collective frames vs forbidden exploratory frames. */
const CONFORM_RE = /^\s*(we\s+need|we'?ve|we'?ll|we\s+can|we\s+should|we\s+must|next,?\s+we)/i
const VIOLATION_RE = /^\s*(let\s+me|i'?ll|i\s+(think|should|need|want|am|'m|guess)|let'?s|maybe\s+i|i\s+want)/i

/** Classify one reasoning block's opener: 'conform' | 'violation' | 'soft'. */
export function classifyOpener(text) {
  const t = String(text ?? '').trim()
  if (CONFORM_RE.test(t)) return 'conform'
  if (VIOLATION_RE.test(t)) return 'violation'
  return 'soft'
}

/** Escalation level derived from the drift counters. */
export function escalationLevel(state) {
  if (state.consecutive >= 3 || state.violations >= 6) return 2
  if (state.consecutive >= 2 || state.violations >= 3) return 1
  return 0
}

/** Per-session drift state. Sessions append events only; the scan resumes from
 * the first event it has not inspected yet, so resume/reload rebuild the same
 * counters from the durable log. */
const stateBySession = new WeakMap()

function stateFor(session) {
  let state = stateBySession.get(session)
  if (state === undefined) {
    state = {
      next: 0,
      violations: 0,
      consecutive: 0,
      conformStreak: 0,
      assertedLevel: 0,
      lastViolation: '',
    }
    stateBySession.set(session, state)
  }
  return state
}

/** Incrementally scan newly appended assistant/message events and classify
 * every reasoning block's opener. */
function scanAndClassify(state, session) {
  const events = session.events
  for (; state.next < events.length; state.next += 1) {
    const event = events[state.next]
    if (event?.type !== 'assistant/message') continue
    const content = event.data?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type !== 'reasoning' || typeof block.text !== 'string') continue
      const label = classifyOpener(block.text)
      if (label === 'conform') {
        state.consecutive = 0
        state.conformStreak += 1
        if (state.conformStreak >= 3 && state.violations > 0) {
          // Recovery: 3 consecutive conforming blocks de-escalate.
          state.violations = Math.max(0, state.violations - 2)
          state.conformStreak = 0
        }
      } else if (label === 'violation') {
        state.consecutive += 1
        state.violations += 1
        state.conformStreak = 0
        state.lastViolation = block.text.trim().slice(0, 140)
      }
      // 'soft' openers neither escalate nor reset — no false-positive feedback.
    }
  }
}

/** Refresh one agent's drift state and level. */
function levelFor(agent) {
  const session = agent?.session
  if (session === undefined) return null
  const state = stateFor(session)
  scanAndClassify(state, session)
  const level = escalationLevel(state)
  if (level < state.assertedLevel) state.assertedLevel = level // re-arm re-assertion
  return { state, level }
}

/** One constant-shaped anchor user message. */
function anchorMessage(text) {
  return {
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    source: { kind: 'micro-inversion-anchor', plugin: name },
    content: [{ type: 'text', text }],
  }
}

const NEAR_ANCHOR_BASE =
  '<system-reminder>\n[anchor] Open this next reasoning block with: we need ...\n</system-reminder>'
const NEAR_ANCHOR_HARD =
  '<system-reminder>\n[anchor] DRIFT DETECTED. Hard rule: this reasoning block MUST open with "we need ...". No "let me", no "I\'ll", no hesitation.\n</system-reminder>'
const RESULT_ANCHOR_BASE =
  '<system-reminder>\n[anchor] Result received. Next reasoning block opens with: we need ...\n</system-reminder>'
const RESULT_ANCHOR_HARD =
  '<system-reminder>\n[anchor] Result received. DRIFT DETECTED. Hard rule: next reasoning block MUST open with "we need ...".\n</system-reminder>'

/** Re-assertion message on escalation, quoting the most recent violation. */
function buildReassertion(state, level) {
  const quote = state.lastViolation.length > 0
    ? ` The last violation opened with: "${state.lastViolation}".`
    : ''
  return `<system-reminder>\n[anchor] RE-ANCHOR (level ${level}): the reasoning opener "we need ..." is mandatory for every chain-of-thought block.${quote} Rewrite the next block with "we need ...".\n</system-reminder>`
}

/** Marker replacing the early-trimmed middle span at level >= 2. */
function buildTrimMarker(split, droppedChars) {
  const start = split.head.length
  const end = start + split.middle.length - 1
  return `<system-reminder>\n[anchor] Re-anchor trim: middle messages ${start}..${end} (~${droppedChars} chars) were removed from this request surface to restore head/tail salience. Full content remains in the session log. Continue with "we need ...".\n</system-reminder>`
}

const DEFAULTS = {
  pressureRatio: 0.4,
  earlyTrimHeadChars: 4096,
  earlyTrimTailChars: 1024,
  driftMaxTokens: 2048,
}
const CONFIG_KEYS = new Set(Object.keys(DEFAULTS))

function resolveConfig(config = {}) {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`${name}: unknown config key "${key}"`)
  }
  const resolved = { ...DEFAULTS, ...config }
  if (typeof resolved.pressureRatio !== 'number' || resolved.pressureRatio <= 0 || resolved.pressureRatio >= 1) {
    throw new Error(`${name}: pressureRatio must be in (0, 1)`)
  }
  for (const key of ['earlyTrimHeadChars', 'earlyTrimTailChars', 'driftMaxTokens']) {
    if (!Number.isInteger(resolved[key]) || resolved[key] <= 0) throw new Error(`${name}: ${key} must be a positive integer`)
  }
  return Object.freeze(resolved)
}

/** Early middle-trim at level >= 2 when pressure exceeds the ratio. */
async function maybeEarlyTrim(ctx, agent, signal, messages, resolved) {
  const meter = ctx.get('tokenMeter')
  const llm = ctx.get('llm')
  if (meter === undefined || llm === undefined) return messages
  const session = agent.session
  const target = routedTarget(session, agent)
  if (target === undefined) return messages
  let windowSize
  try {
    const info = await llm.resolveModelInfo(target.provider, target.model, signal)
    windowSize = info?.context?.contextWindow
  } catch {
    return messages
  }
  if (!Number.isInteger(windowSize) || windowSize <= 0) return messages
  if (signal?.aborted) return messages
  const threshold = Math.floor(windowSize * resolved.pressureRatio)
  if (meter.measure(session).totalTokens < threshold) return messages
  const split = splitSurface(messages, resolved.earlyTrimHeadChars, resolved.earlyTrimTailChars)
  if (split === null) return messages
  const droppedChars = split.middle.reduce((sum, message) => sum + measureMessageChars(message), 0)
  const marker = anchorMessage(buildTrimMarker(split, droppedChars))
  return [...split.head, marker, ...split.tail]
}

/** Register the three global-runtime anchor mechanisms. */
export function apply(ctx, config) {
  const resolved = resolveConfig(config ?? {})

  // ── L2: near-field anchor on every model request ─────────────────────────
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const agent = payload.agent
    if (agent === undefined || payload.signal?.aborted) return decision
    const info = levelFor(agent) ?? { state: null, level: 0 }
    let messages = decision.messages

    // Re-assert once per escalation level, quoting the recent violation.
    if (info.state !== null && info.level > info.state.assertedLevel) {
      messages = [...messages, anchorMessage(buildReassertion(info.state, info.level))]
      info.state.assertedLevel = info.level
    }
    // Level >= 2: early middle trim (restores head/tail salience below 80%).
    if (info.level >= 2) {
      messages = await maybeEarlyTrim(ctx, agent, payload.signal, messages, resolved)
      if (payload.signal?.aborted) return decision
    }
    // Near-field anchor last = nearest the generation point.
    const anchorText = info.level >= 1 ? NEAR_ANCHOR_HARD : NEAR_ANCHOR_BASE
    return { ...decision, messages: [...messages, anchorMessage(anchorText)] }
  }, { prepend: true })

  // ── L3: result anchor through the harness-native additionalContexts ──────
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (decision.kind !== 'accept') return decision
    if (exec.signal?.aborted) return decision
    const info = levelFor(exec.agent) ?? { level: 0 }
    const anchorText = info.level >= 1 ? RESULT_ANCHOR_HARD : RESULT_ANCHOR_BASE
    return {
      ...decision,
      additionalContexts: [...(decision.additionalContexts ?? []), anchorMessage(anchorText)],
    }
  }, { prepend: true })

  // ── D: tighten the output budget while drifting at level >= 2 ────────────
  ctx.on('agent/request', async (payload, next) => {
    const requestConfig = await next()
    const agent = payload?.agent
    if (agent === undefined) return requestConfig
    const info = levelFor(agent) ?? { level: 0 }
    if (info.level >= 2) {
      if (requestConfig.maxTokens === undefined || requestConfig.maxTokens > resolved.driftMaxTokens) {
        return { ...requestConfig, maxTokens: resolved.driftMaxTokens }
      }
      return requestConfig
    }
    if (requestConfig.maxTokens === resolved.driftMaxTokens) {
      const rest = { ...requestConfig }
      delete rest.maxTokens
      return rest
    }
    return requestConfig
  }, { prepend: true })
}
