#!/usr/bin/env node
/**
 * Micro-Inversion Standard — repository integrity gate (odai lesson: canonical
 * validator + version policy, fail-closed). Runs with ZERO npm dependencies so
 * CI can execute it without an install step.
 *
 * Checks:
 *   1. Syntax (`node --check`) of every preset/*.mjs and scripts/*.mjs.
 *   2. agent.cordis.yml local plugin rows (`name: ./x.mjs?v=N`) reference
 *      existing files with a positive integer cache stamp.
 *   3. preset.yml carries the selector metadata (name + description).
 *   4. package.json version equals the newest CHANGELOG.md heading.
 *   5. (warn only) the dist zip for the current version exists.
 *
 * Exit code 0 = all checks pass; 1 = any hard check failed.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const warnings = []
const passes = []

function check(ok, label, detail = '') {
  const line = `${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`
  if (ok) passes.push(line)
  else failures.push(line)
}

function warn(label, detail = '') {
  warnings.push(`! ${label}${detail ? ` — ${detail}` : ''}`)
}

// ── 1. syntax ───────────────────────────────────────────────────────────────
for (const dir of ['preset', 'scripts']) {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) {
    warn(`${dir}/ missing — skipped`)
    continue
  }
  for (const file of readdirSync(abs).filter(f => f.endsWith('.mjs'))) {
    try {
      execFileSync(process.execPath, ['--check', join(abs, file)], { stdio: 'pipe' })
      check(true, `syntax ${dir}/${file}`)
    } catch (error) {
      check(false, `syntax ${dir}/${file}`, String(error.stderr ?? error.message).trim().split('\n')[0])
    }
  }
}

// ── 2. yml local plugin rows ────────────────────────────────────────────────
const ymlPath = join(ROOT, 'preset', 'agent.cordis.yml')
if (!existsSync(ymlPath)) {
  check(false, 'preset/agent.cordis.yml exists')
} else {
  check(true, 'preset/agent.cordis.yml exists')
  const yml = readFileSync(ymlPath, 'utf8')
  const rows = [...yml.matchAll(/^\s*name:\s*(\.\/[\w.-]+\.mjs)\?v=(\d+)/gm)]
  if (rows.length === 0) {
    check(false, 'agent.cordis.yml declares local plugin rows', 'no ./x.mjs?v=N rows found')
  } else {
    for (const [full, file, stamp] of rows) {
      const abs = join(ROOT, 'preset', file)
      const stampOk = Number.isInteger(Number(stamp)) && Number(stamp) > 0
      check(existsSync(abs), `row ${full} → file exists`, existsSync(abs) ? '' : `${file} not found`)
      check(stampOk, `row ${full} → cache stamp`, stampOk ? '' : `?v=${stamp} is not a positive integer`)
    }
  }
}

// ── 3. preset.yml selector metadata ─────────────────────────────────────────
const presetYml = join(ROOT, 'preset', 'preset.yml')
if (!existsSync(presetYml)) {
  check(false, 'preset/preset.yml exists')
} else {
  const text = readFileSync(presetYml, 'utf8')
  check(/^\s*name\s*:/m.test(text), 'preset.yml has name')
  check(/^\s*description\s*:/m.test(text), 'preset.yml has description')
}

// ── 4. version consistency: package.json ↔ CHANGELOG ────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
const heading = changelog.match(/^#\s+(\d+\.\d+\.\d+)/m)?.[1] ?? null
check(
  heading === pkg.version,
  'package.json version matches CHANGELOG heading',
  heading === null ? 'no version heading found' : `package=${pkg.version} changelog=${heading ?? 'none'}`,
)

// ── 5. dist zip for the current version (warn only) ─────────────────────────
const zip = join(ROOT, 'dist', `${pkg.name}-v${pkg.version}.zip`)
if (!existsSync(zip)) warn(`dist/${pkg.name}-v${pkg.version}.zip missing — rebuild before release`)

// ── report ──────────────────────────────────────────────────────────────────
for (const line of passes) console.log(line)
for (const line of warnings) console.log(line)
if (failures.length > 0) {
  for (const line of failures) console.error(line)
  console.error(`\nvalidate: ${failures.length} check(s) FAILED`)
  process.exit(1)
}
console.log(`\nvalidate: ${passes.length} checks passed, ${warnings.length} warning(s)`)
