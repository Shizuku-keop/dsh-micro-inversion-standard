import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyReasoning, hasAnchoredReasoning, decidePromotion, resetToControlled,
  scanEvents, instructionHintMessages, extractInstructionPaths, isAllowedMessage,
} from '../preset/tool-bootstrap.mjs'

test('classifyReasoning: English collective opener is minimal-like', () => {
  assert.equal(classifyReasoning('we need to check the environment.').label, 'minimal-like')
})

test('classifyReasoning: English "let me" is drift', () => {
  assert.equal(classifyReasoning('Let me check the result.').label, 'standard-like')
})

test('classifyReasoning: Chinese collective openers are minimal-like (v5)', () => {
  assert.equal(classifyReasoning('我们需要检查当前环境。').label, 'minimal-like')
  assert.equal(classifyReasoning('我们来处理这个问题。').label, 'minimal-like')
  assert.equal(classifyReasoning('让我们先读取文件。').label, 'minimal-like')
})

test('classifyReasoning: Chinese first-person openers are drift (v5)', () => {
  assert.equal(classifyReasoning('让我看看这个结果。').label, 'standard-like')
  assert.equal(classifyReasoning('我想先运行一个命令。').label, 'standard-like')
})

test('classifyReasoning: ambiguous opener', () => {
  assert.equal(classifyReasoning('好的，我明白了。').label, 'ambiguous')
})

test('hasAnchoredReasoning: uses only the FIRST reasoning block', () => {
  const anchored = [
    { type: 'reasoning', text: 'we need to start.' },
    { type: 'reasoning', text: 'Let me continue.' },
  ]
  assert.equal(hasAnchoredReasoning(anchored), true)
  const drift = [{ type: 'reasoning', text: 'Let me start.' }]
  assert.equal(hasAnchoredReasoning(drift), false)
})

test('decidePromotion: first tool call without gate promotes', () => {
  const policy = { anchorGate: false, promoteAfterFirstResponse: true, maxBootstrapSteps: 4 }
  assert.equal(decidePromotion({ toolCalled: true }, policy), true)
  assert.equal(decidePromotion({ toolCalled: false, responded: false }, policy), false)
})

test('decidePromotion: gate needs anchored / step fallback / turn end', () => {
  const policy = { anchorGate: true, promoteAfterFirstResponse: true, maxBootstrapSteps: 4 }
  assert.equal(decidePromotion({ toolCalled: true, anchored: true }, policy), true)
  assert.equal(decidePromotion({ toolCalled: true, anchored: false, steps: 4 }, policy), true)
  assert.equal(decidePromotion({ toolCalled: true, anchored: false, steps: 1, turnEnded: true }, policy), true)
  assert.equal(decidePromotion({ toolCalled: true, anchored: false, steps: 1, turnEnded: false }, policy), false)
  assert.equal(decidePromotion({ toolCalled: false, responded: true }, policy), true)
})

test('resetToControlled: keeps scan pointer, marks hasCompacted', () => {
  const state = { next: 7, promoted: true, toolCalled: true, responded: true, anchored: true, turnEnded: true, steps: 3, deferredSteps: 1, instructionHinted: true, hasCompacted: false }
  resetToControlled(state)
  assert.equal(state.promoted, false)
  assert.equal(state.next, 7)
  assert.equal(state.hasCompacted, true)
  assert.equal(state.instructionHinted, false)
})

test('scanEvents: tool/call and assistant/message signals', () => {
  const state = { next: 0, promoted: false, toolCalled: false, responded: false, anchored: false, turnEnded: false, steps: 0, deferredSteps: 0, instructionHinted: false, hasCompacted: false }
  const session = { events: [
    { type: 'tool/call' },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'we need to act.' }] } } },
    { type: 'turn/end' },
  ] }
  scanEvents(state, session)
  assert.equal(state.toolCalled, true)
  assert.equal(state.responded, true)
  assert.equal(state.anchored, true)
  assert.equal(state.turnEnded, true)
  assert.equal(state.next, 3)
})

test('scanEvents: compaction/end resets in place, pointer preserved', () => {
  const state = { next: 0, promoted: false, toolCalled: true, responded: true, anchored: false, turnEnded: false, steps: 0, deferredSteps: 0, instructionHinted: false, hasCompacted: false }
  const session = { events: [{ type: 'compaction/end' }] }
  scanEvents(state, session)
  assert.equal(state.hasCompacted, true)
  assert.equal(state.toolCalled, false)
  assert.equal(state.next, 1)
})

test('extractInstructionPaths: parses reference lists', () => {
  const message = { content: [{ type: 'text', text: 'Additional Instructions from: MEMORY.md\nBody.\nUpdated Instructions from: USER.md\nBody2.' }] }
  assert.deepEqual(extractInstructionPaths(message), ['MEMORY.md', 'USER.md'])
})

test('instructionHintMessages: hint once, later injections KEPT in full (v5)', () => {
  const instruction = {
    id: 'inst-1',
    role: 'user',
    source: { kind: 'agent-instructions' },
    content: [{ type: 'text', text: 'Additional Instructions from: MEMORY.md\nSome body.' }],
  }
  const state = { instructionHinted: false }
  const first = instructionHintMessages([instruction], state)
  assert.equal(first.length, 1)
  assert.equal(first[0].source.kind, 'instruction-hint')
  assert.match(first[0].content[0].text, /MEMORY\.md/)
  assert.equal(state.instructionHinted, true)
  const second = instructionHintMessages([instruction], state)
  assert.equal(second.length, 1)
  assert.equal(second[0].source.kind, 'agent-instructions')
})

test('isAllowedMessage: whitelist + untagged kept (v5)', () => {
  const allowed = new Set(['user', 'goal'])
  assert.equal(isAllowedMessage({ source: { kind: 'user' } }, allowed), true)
  assert.equal(isAllowedMessage({ source: { kind: 'tool' } }, allowed), false)
  assert.equal(isAllowedMessage({ source: {} }, allowed), true)
  assert.equal(isAllowedMessage({}, allowed), true)
})
