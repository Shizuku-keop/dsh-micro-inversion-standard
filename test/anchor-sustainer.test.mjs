import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyOpener, escalationLevel, scanAndClassify, resolveConfig } from '../preset/anchor-sustainer.mjs'

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
  return { next: 0, violations: 0, consecutive: 0, conformStreak: 0, assertedLevel: 0, lastViolation: '', lastLoggedLevel: 0 }
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
