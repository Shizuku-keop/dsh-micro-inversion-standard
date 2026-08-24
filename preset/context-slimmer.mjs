/**
 * Micro-Inversion Standard — context slimming hooks.
 *
 * Hook 1 — `tools/post-execute` (result trims, requirement 3a):
 *   A successful tool result whose text exceeds `resultTrimThresholdChars`
 *   (default 8192) is replaced with a bounded head (`resultHeadChars`, 4096)
 *   + middle marker + tail (`resultTailChars`, 1024) projection. The FULL text
 *   is spilled to a session-scoped spill artifact through `ctx.spillStore`
 *   when available, and the locator/retrieval guidance is cited in the marker
 *   so the model can re-read it. Errors, value-replacement decisions, nested
 *   composite calls (their rendered copy is caught on the outer result), and
 *   any result carrying a non-text block are left untouched. Best-effort: a
 *   spill failure logs and degrades to a marker without a locator — it never
 *   turns a successful call into an error.
 *
 * Hook 2 — `agent/pre-step` (surface trims, requirement 3b):
 *   When the token meter reports current pressure at or above
 *   `pressureRatio` (default 0.8) of the routed model's context window, the
 *   request surface's MIDDLE messages are replaced by ONE constant marker
 *   message, keeping the head `surfaceHeadChars` (4096) and tail
 *   `surfaceTailChars` (1024) of the surface. Only whole messages are cut at
 *   message boundaries (a straddling message is kept whole, so the budget is
 *   a target, not a hard cap). The system prompt, the head prefix, and the
 *   tail are never reordered or rewritten; the durable session log keeps the
 *   full content (`/compact` produces the durable summary). With
 *   `spillTrimmedSurface: true` the trimmed middle is also spilled.
 *
 * KV-cache policy (requirement 4): both hooks only ever replace a contiguous
 * middle span — one tool-result node's text in place, or one middle message
 * span — with a single short, constant-shaped marker. Everything else in the
 * wire surface (system prompt, tool catalog, head messages, tail messages)
 * stays byte-identical, so the provider's KV cache for the unchanged prefix
 * keeps hitting.
 *
 * Publishes no service; consumes only host-plane services via `ctx.get`
 * (`spillStore`, `tokenMeter`, `llm`) plus the `tools` waterfall (injected).
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'micro-inversion-context-slimmer'

/** The `tools/post-execute` waterfall must exist before this listener runs. */
export const inject = ['tools']

/** Low-friction defaults for coding-agent output. */
const DEFAULTS = {
  resultTrimThresholdChars: 8192,
  resultHeadChars: 4096,
  resultTailChars: 1024,
  pressureRatio: 0.8,
  surfaceHeadChars: 4096,
  surfaceTailChars: 1024,
  spillResults: true,
  spillTrimmedSurface: false,
  skipTools: [],
}

const CONFIG_KEYS = new Set(Object.keys(DEFAULTS))

/** Fixed marker substituted for every removed middle span of a tool result. */
const RESULT_MARKER = '\n\n[... micro-inversion: result trimmed'

/** Count Unicode code points without splitting surrogate pairs. */
function codePointLength(text) {
  return Array.from(text).length
}

/** Measure only text blocks (non-text blocks cost zero). */
function measureBlocks(blocks) {
  let chars = 0
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') chars += codePointLength(block.text)
  }
  return chars
}

/** All-text content flattened to one string, or `undefined` if any block is non-text. */
function flattenPlainText(content) {
  let text = ''
  for (const block of content) {
    if (block?.type !== 'text') return undefined
    if (typeof block.text !== 'string') return undefined
    text += block.text
  }
  return text
}

/** Measure one message's text content in Unicode code points. */
export function measureMessageChars(message) {
  return measureBlocks(Array.isArray(message?.content) ? message.content : [])
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name}: ${field} must be a positive integer`)
  return value
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name}: ${field} must be a non-negative integer`)
  return value
}

function booleanFlag(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${name}: ${field} must be a boolean`)
  return value
}

function stringList(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be an array of non-empty strings`)
  }
  return [...new Set(value)]
}

/** Resolve and validate configuration. */
export function resolveConfig(config = {}) {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`${name}: unknown config key "${key}"`)
  }
  const resolved = { ...DEFAULTS, ...config }
  resolved.resultTrimThresholdChars = positiveInteger(resolved.resultTrimThresholdChars, 'resultTrimThresholdChars')
  resolved.resultHeadChars = nonNegativeInteger(resolved.resultHeadChars, 'resultHeadChars')
  resolved.resultTailChars = nonNegativeInteger(resolved.resultTailChars, 'resultTailChars')
  resolved.surfaceHeadChars = nonNegativeInteger(resolved.surfaceHeadChars, 'surfaceHeadChars')
  resolved.surfaceTailChars = nonNegativeInteger(resolved.surfaceTailChars, 'surfaceTailChars')
  if (resolved.resultHeadChars + RESULT_MARKER.length + resolved.resultTailChars > resolved.resultTrimThresholdChars) {
    throw new Error(`${name}: resultHeadChars + marker + resultTailChars must be at most resultTrimThresholdChars`)
  }
  if (typeof resolved.pressureRatio !== 'number' || resolved.pressureRatio <= 0 || resolved.pressureRatio >= 1) {
    throw new Error(`${name}: pressureRatio must be in (0, 1)`)
  }
  resolved.spillResults = booleanFlag(resolved.spillResults, 'spillResults')
  resolved.spillTrimmedSurface = booleanFlag(resolved.spillTrimmedSurface, 'spillTrimmedSurface')
  resolved.skipTools = stringList(resolved.skipTools, 'skipTools')
  return Object.freeze(resolved)
}

/**
 * Resolve the exact provider/model durably routed for the latest request,
 * falling back to the agent's own options (mirrors dsh-compaction-basic).
 */
export function routedTarget(session, agent) {
  const header = session.requestHeader?.()
  const config = header?.config
  if (config !== undefined
    && typeof config.provider === 'string' && config.provider.length > 0
    && typeof config.model === 'string' && config.model.length > 0) {
    return { provider: config.provider, model: config.model }
  }
  const options = agent?.options
  if (options !== undefined
    && typeof options.provider === 'string' && options.provider.length > 0
    && typeof options.model === 'string' && options.model.length > 0) {
    return { provider: options.provider, model: options.model }
  }
  return undefined
}

/**
 * Split the message surface into head / middle / tail at WHOLE-message
 * boundaries: head keeps every leading message whose cumulative text fits
 * within `headChars` (a straddling message is kept whole, so the head may
 * exceed the budget slightly); tail mirrors from the end. Returns `null` when
 * head and tail overlap or cover everything (nothing to trim).
 */
export function splitSurface(messages, headChars, tailChars) {
  const counts = messages.map(measureMessageChars)
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total <= headChars + tailChars) return null

  let headEnd = 0
  let acc = 0
  for (; headEnd < messages.length; headEnd += 1) {
    acc += counts[headEnd]
    if (acc >= headChars) {
      headEnd += 1
      break
    }
  }

  let tailStart = messages.length
  acc = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    acc += counts[i]
    tailStart = i
    if (acc >= tailChars) break
  }

  if (tailStart <= headEnd) return null
  return {
    head: messages.slice(0, headEnd),
    middle: messages.slice(headEnd, tailStart),
    tail: messages.slice(tailStart),
  }
}

/** One constant-shaped marker message replacing the trimmed middle span. */
function buildSurfaceMarker(split, droppedChars, percent) {
  const start = split.head.length
  const end = start + split.middle.length - 1
  return {
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: '<system-reminder>\n'
        + `[micro-inversion: context pressure reached ${percent}% of the model window. Messages ${start}..${end} (~${droppedChars} chars) were trimmed from this request surface; the durable session log keeps the full content, and /compact produces a durable summary. The system prompt, tool catalog, head prefix, and tail are unchanged.]`
        + '\n</system-reminder>',
    }],
    source: { kind: 'micro-inversion-trim', plugin: name },
  }
}

/** Register the two context-slimming hooks. */
export function apply(ctx, config) {
  const resolved = resolveConfig(config ?? {})

  // ── Hook 1: tools/post-execute — trim oversized results, spill the full text.
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (decision.kind !== 'accept' || decision.value !== undefined) return decision
    if (result.isError) return decision
    if (exec.signal?.aborted) return decision
    if (resolved.skipTools.includes(exec.name)) return decision

    const content = decision.content !== undefined ? decision.content : result.content
    if (!Array.isArray(content) || content.length === 0) return decision
    const text = flattenPlainText(content)
    if (text === undefined) return decision // carries a non-text block — leave it
    const total = codePointLength(text)
    if (total <= resolved.resultTrimThresholdChars) return decision

    // Spill the FULL text (best-effort; a failure must never break the call).
    let notice = ''
    if (resolved.spillResults) {
      const store = ctx.get('spillStore')
      const agent = exec.agent
      if (store !== undefined && agent?.session !== undefined) {
        try {
          const ref = await store.saveText({
            owner: { sessionId: agent.session.header.id },
            source: { toolName: exec.name, callId: exec.callId, label: 'result' },
            suggestedName: `${exec.name}-result.txt`,
            content: text,
          })
          // `locator` is the model-facing handle (a local path for spill-local);
          // `retrievalHint` is generic prose, not the path — cite the locator first.
          const locator = String(ref.locator)
          const hint = typeof ref.retrievalHint === 'string' && ref.retrievalHint.length > 0
            ? ` ${ref.retrievalHint}`
            : ''
          notice = ` Full result: ${locator} (${ref.bytes} bytes).${hint}`
        } catch (error) {
          try {
            ctx.logger.warn(`${name}: spill failed for ${exec.name}: ${error?.message ?? error}`)
          } catch {
            // Logger unavailable — best-effort only.
          }
        }
      }
    }
    if (exec.signal?.aborted) return decision

    const points = Array.from(text)
    const head = points.slice(0, resolved.resultHeadChars).join('')
    const tail = points.slice(points.length - resolved.resultTailChars).join('')
    const marker = `${RESULT_MARKER} from ${total} to ${resolved.resultHeadChars + resolved.resultTailChars} chars (head ${resolved.resultHeadChars} / tail ${resolved.resultTailChars}).${notice} ...]\n\n`
    return { kind: 'accept', content: [{ type: 'text', text: head + marker + tail }] }
  }, { prepend: true })

  // ── Hook 2: agent/pre-step — at 80% window pressure, trim the middle span.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const agent = payload.agent
    const signal = payload.signal
    const session = agent?.session
    if (session === undefined) return decision
    const messages = decision.messages
    if (!Array.isArray(messages) || messages.length < 2) return decision

    // Cheap gate: if the surface cannot even fill head + tail, no trim is
    // possible — skip the token-meter and model-info lookups entirely.
    const totalChars = messages.reduce((sum, message) => sum + measureMessageChars(message), 0)
    if (totalChars <= resolved.surfaceHeadChars + resolved.surfaceTailChars) return decision
    if (signal?.aborted) return decision

    // Pressure gate: current request pressure vs the routed model's window.
    const meter = ctx.get('tokenMeter')
    const llm = ctx.get('llm')
    let percent = 0
    if (meter !== undefined && llm !== undefined) {
      const target = routedTarget(session, agent)
      if (target !== undefined) {
        try {
          const info = await llm.resolveModelInfo(target.provider, target.model, signal)
          const windowSize = info?.context?.contextWindow
          if (Number.isInteger(windowSize) && windowSize > 0) {
            const measurement = meter.measure(session)
            const threshold = Math.floor(windowSize * resolved.pressureRatio)
            if (measurement.totalTokens < threshold) return decision
            percent = Math.min(100, Math.round((measurement.totalTokens / windowSize) * 100))
          }
        } catch {
          // Unknown window / route: skip trimming — never brick the request.
          return decision
        }
      }
    }
    if (signal?.aborted) return decision

    const split = splitSurface(messages, resolved.surfaceHeadChars, resolved.surfaceTailChars)
    if (split === null) return decision

    const droppedChars = split.middle.reduce((sum, message) => sum + measureMessageChars(message), 0)
    const marker = buildSurfaceMarker(split, droppedChars, percent)

    let trimmed = [...split.head, marker, ...split.tail]
    if (resolved.spillTrimmedSurface) {
      const store = ctx.get('spillStore')
      if (store !== undefined) {
        try {
          const text = split.middle
            .map(message => (Array.isArray(message?.content) ? message.content : []))
            .flat()
            .map(block => (block?.type === 'text' ? block.text : ''))
            .join('\n')
          const ref = await store.saveText({
            owner: { sessionId: session.header.id },
            source: { toolName: 'agent-pre-step', callId: 'surface-trim', label: 'middle' },
            suggestedName: 'trimmed-middle.txt',
            content: text,
          })
          marker.content = [{
            type: 'text',
            text: marker.content[0].text
              + ` Trimmed span: ${ref.retrievalHint || ref.locator} (${ref.bytes} bytes).`,
          }]
        } catch {
          // Best-effort — the marker already points at the durable log.
        }
      }
    }

    return { ...decision, messages: trimmed }
  }, { prepend: true })
}
