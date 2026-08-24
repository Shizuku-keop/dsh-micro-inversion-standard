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
 *      every reasoning block (bilingual EN/ZH). Violations escalate ONLY the
 *      anchor wording and inject a re-assertion message — style drift never
 *      triggers context trimming or output-budget caps (v3; wording
 *      compliance must never take priority over task completeness). Recovery
 *      (>=3 consecutive conforming blocks) de-escalates.
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

/** Opener classifier: conforming collective frames vs forbidden exploratory frames. */
// v5: bilingual — English and Chinese collective frames conform, English and
// Chinese first-person/exploratory frames violate (中文思维链检测).
const CONFORM_RE = /^\s*(we\s+need|we'?ve|we'?ll|we\s+can|we\s+should|we\s+must|next,?\s+we|我们(需要|可以|应该|必须|要|先|再|得|一起|来)|让我们)/i
const VIOLATION_RE = /^\s*(let\s+me|i'?ll|i\s+(think|should|need|want|am|'m|guess)|let'?s|maybe\s+i|i\s+want|让我(?!们)|我来|我想|我认为|我觉得|我猜|我打算|我准备|我需要)/i

/** Classify one reasoning block's opener: 'conform' | 'violation' | 'soft'. */
export function classifyOpener(text) {
  const t = String(text ?? '').trim()
  if (CONFORM_RE.test(t)) return 'conform'
  if (VIOLATION_RE.test(t)) return 'violation'
  return 'soft'
}

/**
 * Escalation level derived from the drift counters. Style drift is a SOFT
 * signal: it escalates the anchor wording and re-assertion only — it NEVER
 * triggers context trimming or output-budget caps, so wording compliance can
 * never take priority over task completeness.
 */
export function escalationLevel(state) {
  if (state.consecutive >= 3 || state.violations >= 5) return 1
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
      lastLoggedLevel: 0,
    }
    stateBySession.set(session, state)
  }
  return state
}

/** Incrementally scan newly appended assistant/message events and classify
 * the FIRST reasoning block of each message (the frame-setter). Later blocks
 * are continuations and do NOT escalate — style policing must never punish
 * legitimate follow-through. */
export function scanAndClassify(state, session) {
  const events = session.events ?? []
  for (; state.next < events.length; state.next += 1) {
    const event = events[state.next]
    if (event?.type !== 'assistant/message') continue
    const content = event.data?.message?.content
    if (!Array.isArray(content)) continue
    const first = content.find(block => block?.type === 'reasoning' && typeof block.text === 'string')
    if (first === undefined) continue
    const label = classifyOpener(first.text)
    if (label === 'conform') {
      state.consecutive = 0
      state.conformStreak += 1
      if (state.conformStreak >= 3 && state.violations > 0) {
        // Recovery: 3 consecutive conforming messages de-escalate.
        state.violations = Math.max(0, state.violations - 2)
        state.conformStreak = 0
      }
    } else if (label === 'violation') {
      state.consecutive += 1
      state.violations += 1
      state.conformStreak = 0
      state.lastViolation = first.text.trim().slice(0, 140)
    }
    // 'soft' openers neither escalate nor reset — no false-positive feedback.
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
  '<system-reminder>\n[we] open next block: we need ...\n</system-reminder>'
const NEAR_ANCHOR_HARD =
  '<system-reminder>\n[we] DRIFT. Hard rule: this block MUST open "we need ...". No "let me", no "I\'ll".\n</system-reminder>'
const RESULT_ANCHOR_BASE =
  '<system-reminder>\n[we] result in hand — next block: we need ...\n</system-reminder>'
const RESULT_ANCHOR_HARD =
  '<system-reminder>\n[we] result in hand — DRIFT. Hard rule: next block MUST open "we need ...".\n</system-reminder>'

/** Re-assertion message on escalation, quoting the most recent violation. */
function buildReassertion(state, level) {
  const quote = state.lastViolation.length > 0
    ? ` The last violation opened with: "${state.lastViolation}".`
    : ''
  return `<system-reminder>\n[we] RE-ANCHOR (level ${level}): the reasoning opener "we need ..." is mandatory.${quote} Rewrite the next block with "we need ...".\n</system-reminder>`
}

const DEFAULTS = {
  // Keep only the newest N anchor messages in the request surface; older
  // durable anchors stop being re-paid on every request (their text still
  // lives in the log, it just no longer enters the surface).
  maxAnchorsInSurface: 1,
  // Tool-result continuations already carry the L3 result anchor; do not
  // re-inject the L2 near-field anchor on those steps (redundant cost).
  anchorAfterToolResult: false,
}
const CONFIG_KEYS = new Set(Object.keys(DEFAULTS))

export function resolveConfig(config = {}, logger) {
  const log = typeof logger?.warn === 'function' ? logger : console
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) log.warn(`${name}: ignoring unknown config key "${key}"`)
  }
  const resolved = { ...DEFAULTS, ...config }
  if (!Number.isInteger(resolved.maxAnchorsInSurface) || resolved.maxAnchorsInSurface < 0) {
    throw new Error(`${name}: maxAnchorsInSurface must be a non-negative integer`)
  }
  if (typeof resolved.anchorAfterToolResult !== 'boolean') {
    throw new Error(`${name}: anchorAfterToolResult must be a boolean`)
  }
  return Object.freeze(resolved)
}

const ANCHOR_KIND = 'micro-inversion-anchor'
const isAnchor = (m) => m?.source?.kind === ANCHOR_KIND

/** The last non-anchor message of a surface, or undefined. */
function lastRealMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isAnchor(messages[i])) return messages[i]
  }
  return undefined
}

/**
 * Register the two anchor mechanisms (L2 near-field, L3 result) plus the soft
 * drift-reinforcement loop (D). Style drift ONLY escalates anchor wording and
 * re-assertion — it NEVER triggers context trimming or output-budget caps, so
 * wording compliance can never take priority over task completeness. Context
 * management stays solely with context-slimmer (explicit pressure gate).
 *
 * v4 (cost fixes from the peak-valley real task): the request surface keeps a
 * BOUNDED anchor tail (old durable anchors stop entering requests), and the L2
 * near-field anchor is skipped on tool-result continuations (the L3 result
 * anchor already covers that transition).
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config ?? {}, ctx.logger)

  // ── L2: near-field anchor on model requests ──────────────────────────────
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const agent = payload.agent
    if (agent === undefined || payload.signal?.aborted) return decision
    const info = levelFor(agent) ?? { state: null, level: 0 }
    // v5 observability: log drift-level transitions so the loop is traceable
    // without a dev tool (in-memory counters are not otherwise queryable).
    if (info.state !== null && info.level !== info.state.lastLoggedLevel) {
      info.state.lastLoggedLevel = info.level
      try {
        ctx.logger.info(
          `${name}: drift level ${info.level} `
          + `(violations=${info.state.violations}, consecutive=${info.state.consecutive}, `
          + `lastViolation=${JSON.stringify(info.state.lastViolation)})`,
        )
      } catch {
        // Logger unavailable — best-effort only.
      }
    }
    let messages = decision.messages

    // Bound the durable-anchor tail: drop oldest anchors from the surface.
    const anchorIdx = []
    messages.forEach((m, i) => { if (isAnchor(m)) anchorIdx.push(i) })
    if (anchorIdx.length > resolved.maxAnchorsInSurface) {
      const drop = new Set(anchorIdx.slice(0, anchorIdx.length - resolved.maxAnchorsInSurface))
      messages = messages.filter((_, i) => !drop.has(i))
    }

    // Re-assert once per escalation, quoting the recent violation.
    if (info.state !== null && info.level > info.state.assertedLevel) {
      messages = [...messages, anchorMessage(buildReassertion(info.state, info.level))]
      info.state.assertedLevel = info.level
    }
    // Tool-result continuation: L3 already anchored this transition — skip.
    if (!resolved.anchorAfterToolResult && lastRealMessage(messages)?.source?.kind === 'tool') {
      return { ...decision, messages }
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
}
