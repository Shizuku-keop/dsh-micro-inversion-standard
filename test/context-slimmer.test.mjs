import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveConfig, splitSurface, splitTrimable, measureMessageChars, fitTrim,
  buildSurfaceMarker,
} from '../preset/context-slimmer.mjs'

const m = (id, kind, text, role) => ({
  id, role: role ?? 'user', source: { kind, callId: id },
  content: [{ type: 'text', text }],
})

test('resolveConfig: unknown keys warn and are ignored (v5)', () => {
  const warns = []
  const logger = { warn: (msg) => warns.push(msg) }
  const cfg = resolveConfig({ resultTrimThresholdChars: 4096, typoKey: 1, spillResults: false }, logger)
  assert.equal(cfg.resultTrimThresholdChars, 4096)
  assert.equal(cfg.spillResults, false)
  assert.equal(cfg.dropProtectedUnderPressure, false)
  assert.ok(warns.some(w => w.includes('typoKey')))
})

test('resolveConfig: invalid values still throw', () => {
  assert.throws(() => resolveConfig({ pressureRatio: 0 }))
  assert.throws(() => resolveConfig({ resultTrimThresholdChars: 4 }))
})

test('splitSurface: whole-message head/tail split', () => {
  const messages = [
    m('a', 'user', 'A'.repeat(100)),
    m('b', 'tool', 'B'.repeat(100)),
    m('c', 'tool', 'C'.repeat(100)),
    m('d', 'user', 'D'.repeat(100)),
  ]
  const s = splitSurface(messages, 100, 100)
  assert.ok(s !== null)
  assert.equal(s.head.length, 1)
  assert.equal(s.tail.length, 1)
  assert.equal(s.middle.length, 2)
})

test('splitSurface: null when everything fits', () => {
  assert.equal(splitSurface([m('a', 'user', 'short'), m('b', 'tool', 'short')], 4096, 1024), null)
})

test('splitTrimable: protected messages kept in the middle', () => {
  const messages = [
    m('a', 'user', 'A'.repeat(2000)),
    m('b', 'tool', 'B'.repeat(2000)),
    m('c', 'user', 'C'.repeat(2000)),
    m('d', 'tool', 'D'.repeat(2000)),
    m('e', 'user', 'E'.repeat(2000)),
  ]
  const s = splitTrimable(messages, 1000, 1000)
  assert.ok(s !== null)
  assert.equal(s.trimable.length, 2)
  assert.equal(s.keptMiddle.length, 1)
  assert.equal(s.droppedProtected, false)
})

test('splitTrimable: all-protected middle returns null by default', () => {
  const messages = [
    m('a', 'user', 'A'.repeat(2000)),
    m('b', 'user', 'B'.repeat(2000)),
    m('c', 'user', 'C'.repeat(2000)),
  ]
  assert.equal(splitTrimable(messages, 2500, 2500), null)
})

test('splitTrimable: dropProtectedUnderPressure last resort (v5)', () => {
  const messages = [
    m('a', 'user', 'A'.repeat(2000)),
    m('b', 'user', 'B'.repeat(2000)),
    m('c', 'user', 'C'.repeat(2000)),
  ]
  const s = splitTrimable(messages, 1000, 1000, { dropProtected: true })
  assert.ok(s !== null)
  assert.equal(s.droppedProtected, true)
  assert.equal(s.trimable.length, 1)
})

test('buildSurfaceMarker: enumerates kinds and call ids + last-resort note', () => {
  const split = {
    head: [{ id: 'h' }],
    keptMiddle: [],
    trimable: [m('b1', 'tool', 'x'), m('b2', 'tool', 'y')],
    tail: [{ id: 't' }],
    droppedChars: 42,
    droppedProtected: false,
  }
  const marker = buildSurfaceMarker(split, 42, 81)
  const text = marker.content[0].text
  assert.match(text, /tool×2/)
  assert.match(text, /b1, b2/)
  assert.match(text, /were NEVER trimmed/)

  const split2 = { ...split, trimable: [m('u', 'user', 'z')], droppedProtected: true }
  assert.match(buildSurfaceMarker(split2, 10, 81).content[0].text, /LAST-RESORT DROP/)
})

test('fitTrim: stays inside the threshold even with a long marker (v5)', () => {
  const text = 'x'.repeat(20000)
  const marker = '[marker]' + 'y'.repeat(5000) // > 8192 - 4096, forces head shrink
  const fit = fitTrim(text, 4096, 1024, marker, 8192)
  assert.ok(fit !== null)
  assert.ok(fit.totalChars <= 8192)
  assert.ok(fit.headChars < 4096)
})

test('fitTrim: null when the marker alone cannot fit', () => {
  assert.equal(fitTrim('x'.repeat(100), 1, 1, 'm'.repeat(9000), 8192), null)
})

test('fitTrim: surrogate pairs are never split', () => {
  const fit = fitTrim('😀'.repeat(5000), 100, 50, '[]', 200)
  assert.ok(fit !== null)
  assert.ok(!fit.head.endsWith('\uD83D'))
  assert.ok(!fit.tail.endsWith('\uD83D'))
})

test('measureMessageChars: counts text blocks in code points', () => {
  assert.equal(measureMessageChars({ content: [{ type: 'text', text: 'a😀b' }] }), 3)
})
