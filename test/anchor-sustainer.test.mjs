import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyOpener,
  escalationLevel,
  scanAndClassify,
  shouldThrottleNearAnchor,
  resolveConfig,
} from '../preset/anchor-sustainer.mjs'

test('classifyOpener: English frames', () => {
  assert.equal(classifyOpener('we need to verify the fix.'), 'conform')
  assert.equal(classifyOpener('We should check this.'), 'conform')
  assert.equal(classifyOpener('Let me run the command.'), 'violation')
  assert.equal(classifyOpener("I'll look into it."), 'violation')
  assert.equal(classifyOpener('Interesting!'), 'soft')
})

test('classifyOpener: Chinese frames (v5)', () => {
  assert.equal(classifyOpener('我们需要先读取文件。'), 'conform')
  assert.equal(classifyOpener('我们来检查一下。'), 'conform')
  assert.equal(classifyOpener('让我们继续。'), 'conform')
  assert.equal(classifyOpener('让我看看结果。'), 'violation')
  assert.equal(classifyOpener('我想先运行命令。'), 'violation')
  assert.equal(classifyOpener('好的。'), 'soft')
})

test('escalationLevel: thresholds', () => {
  assert.equal(escalationLevel({ consecutive: 2, violations: 4 }), 0)
  assert.equal(escalationLevel({ consecutive: 3, violations: 4 }), 1)
  assert.equal(escalationLevel({ consecutive: 0, violations: 5 }), 1)
})

function freshState() {
  return { next: 0, violations: 0, consecutive: 0, conformStreak: 0, assertedLevel: 0, lastViolation: '', lastLoggedLevel: 0, lastThrottled: false }
}

test('scanAndClassify: consecutive violations escalate', () => {
  const s = freshState()
  const events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'Let me check.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'I think so.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'Let me run it.' }] } } },
  ]
  scanAndClassify(s, { events })
  assert.equal(s.violations, 3)
  assert.equal(s.consecutive, 3)
  assert.equal(escalationLevel(s), 1)
})

test('scanAndClassify: 3 conforming blocks recover violations', () => {
  const s = freshState()
  const events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'Let me check.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'I think so.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need to act.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we can continue.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we should finish.' }] } } },
  ]
  scanAndClassify(s, { events })
  assert.equal(s.violations, 0)
  assert.equal(s.consecutive, 0)
})

test('scanAndClassify: only the FIRST reasoning block classifies', () => {
  const s = freshState()
  const events = [
    { type: 'assistant/message', data: { message: { content: [
      { type: 'reasoning', text: 'we need to start.' },
      { type: 'reasoning', text: 'Let me continue this…' },
    ] } } },
  ]
  scanAndClassify(s, { events })
  assert.equal(s.violations, 0)
  assert.equal(s.consecutive, 0)
})

test('resolveConfig: unknown keys warn and are ignored (v5)', () => {
  const warns = []
  const logger = { warn: (msg) => warns.push(msg) }
  const cfg = resolveConfig({ maxAnchorsInSurface: 2, typoKey: true }, logger)
  assert.equal(cfg.maxAnchorsInSurface, 2)
  assert.equal(cfg.anchorAfterToolResult, false)
  assert.ok(warns.some(w => w.includes('typoKey')))
  assert.throws(() => resolveConfig({ maxAnchorsInSurface: -1 }))
})

// ── v6: stable-compliance throttling ────────────────────────────────────────

test('scanAndClassify: a soft opener resets the conform streak (v6)', () => {
  const s = freshState()
  const events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need to check.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we can proceed.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'The output shows…' }] } } },
  ]
  scanAndClassify(s, { events })
  assert.equal(s.conformStreak, 0, 'soft opener must break the stable streak')
  assert.equal(s.violations, 0, 'soft still never counts as a violation')
  assert.equal(s.consecutive, 0)
})

test('scanAndClassify: conforming streak accumulates for throttling (v6)', () => {
  const s = freshState()
  const events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need one.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need two.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need three.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need four.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need five.' }] } } },
  ]
  scanAndClassify(s, { events })
  assert.equal(s.conformStreak, 5)
})

test('scanAndClassify: a violation resets the conform streak (v6)', () => {
  const s = freshState()
  const events = [
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need one.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need two.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need three.' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'Let me check.' }] } } },
  ]
  scanAndClassify(s, { events })
  assert.equal(s.conformStreak, 0, 'violation must reset the streak so throttling re-arms')
  assert.equal(s.violations, 1)
})

test('throttle flow: engage → soft re-arms → engage again (v6)', () => {
  const cfg = resolveConfig({})
  const s = freshState()
  const conform = (text) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text }] } } })
  // scanAndClassify scans `session.events` from the state's durable pointer;
  // the test resets it per batch to re-scan a fresh slice.
  s.next = 0
  scanAndClassify(s, { events: [conform('we need a.'), conform('we need b.'), conform('we need c.'), conform('we need d.')] })
  assert.equal(shouldThrottleNearAnchor(s, 0, cfg), true, '4 conforms engage the throttle')
  s.next = 0
  scanAndClassify(s, { events: [conform('The output shows…')] }) // soft opener
  assert.equal(s.conformStreak, 0)
  assert.equal(shouldThrottleNearAnchor(s, 0, cfg), false, 'a soft opener re-arms the anchor')
  s.next = 0
  scanAndClassify(s, { events: [conform('we need e.'), conform('we need f.'), conform('we need g.'), conform('we need h.')] })
  assert.equal(shouldThrottleNearAnchor(s, 0, cfg), true, 'a fresh streak re-engages the throttle')
})

test('shouldThrottleNearAnchor: engages at the threshold, base level only (v6)', () => {
  const cfg = resolveConfig({})
  assert.equal(cfg.throttleAfterConforms, 4, 'default throttle threshold is 4')
  const s = { conformStreak: 4, violations: 0 }
  assert.equal(shouldThrottleNearAnchor(s, 0, cfg), true)
  assert.equal(shouldThrottleNearAnchor({ conformStreak: 3, violations: 0 }, 0, cfg), false)
  // Escalated sessions are never throttled.
  assert.equal(shouldThrottleNearAnchor({ conformStreak: 9, violations: 6 }, 1, cfg), false)
  // Null state (no session) never throttles.
  assert.equal(shouldThrottleNearAnchor(null, 0, cfg), false)
})

test('shouldThrottleNearAnchor: 0 disables throttling (v6)', () => {
  const cfg = resolveConfig({ throttleAfterConforms: 0 })
  assert.equal(shouldThrottleNearAnchor({ conformStreak: 100, violations: 0 }, 0, cfg), false)
})

test('resolveConfig: throttleAfterConforms validation (v6)', () => {
  assert.throws(() => resolveConfig({ throttleAfterConforms: -1 }))
  assert.throws(() => resolveConfig({ throttleAfterConforms: 2.5 }))
  assert.throws(() => resolveConfig({ throttleAfterConforms: '4' }))
  assert.equal(resolveConfig({ throttleAfterConforms: 2 }).throttleAfterConforms, 2)
})
