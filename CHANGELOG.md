# 2.2.0 (2026-08-25) — v5 hardening + v3/v4 backfill

This release records the previously-unlogged v3/v4 work and adds the v5
hardening pass. The dist zip is rebuilt as `dsh-micro-inversion-standard-v2.2.0.zip`.

## v5 — hardening fixes (this release)

- **Bilingual opener detection (EN/ZH)**: `classifyReasoning` (tool-bootstrap)
  and `classifyOpener` (anchor-sustainer) now recognise Chinese collective
  openers (`我们需要 / 我们来 / 让我们`) and Chinese first-person openers
  (`让我 / 我想 / 我认为` …). The drift loop no longer goes blind when the
  model reasons in Chinese.
- **Instruction hint no longer swallows instructions**: the one-time hint still
  replaces the first `agent-instructions` dump, but LATER injections stay
  visible in full — a mid-session instruction update reaches the model again.
- **Post-compaction output budget**: after `compaction/end` the warm session
  keeps the FULL output budget (new knob `postCompactionMaxTokens`, default
  none) instead of re-applying the cold-start 1024 cap to mid-task replies.
- **Respect user-set maxTokens**: the bootstrap cap only ever LOWERS a larger
  (or default) budget; an explicitly smaller user budget is preserved. The
  promoted-side strip is identity-checked against both caps this plugin sets.
- **Phase-1 message whitelist is non-destructive**: messages without a
  `source.kind` tag are kept (was: silently dropped); a one-time warning is
  logged when the whitelist drops anything.
- **Result markers fit the threshold**: `fitTrim` sizes head/tail against the
  REAL marker length (locator notice included), so a long path never pushes the
  trimmed result over `resultTrimThresholdChars`.
- **Config typos cannot break the mount**: unknown config keys now warn and are
  ignored (both `context-slimmer` and `anchor-sustainer`); type/range errors
  still throw.
- **Last-resort pressure trim**: new knob `dropProtectedUnderPressure`
  (default false) — at high pressure, drop even an all-protected middle, with
  the marker explicitly saying protected content went.
- **Drift observability**: drift-level transitions are logged to the session log
  (counters are otherwise in-memory only).
- **Tests**: 33 node:test cases added under `test/` (`npm test`).
- **Docs/packaging**: README + NOTICE rewritten for v2-v5; CHANGELOG backfilled;
  install scripts are now transactional; publish scripts default to v2.2.0;
  stale v1.0.0 dist zip removed and replaced with the v2.2.0 build.

## v4 — cost fixes (from the peak-valley real-task observation, previously unlogged)

- Bounded anchor tail in the request surface: `maxAnchorsInSurface: 1` — old
  durable anchors stop entering requests (their text still lives in the log).
- Skip the L2 near-field anchor on tool-result continuations (the L3 result
  anchor already covers that transition) — `anchorAfterToolResult: false`.
- Shorter anchor texts (~12 tokens instead of ~30).
- Verified on the plugins-desc task: anchors 16 → 9, billed input −53%,
  grade 5/5 intact.

## v3 — completeness & review fixes (previously unlogged)

- **Strict pressure gate** (real bug fix): the 80% middle-trim never runs when
  the meter/llm/window is unknown — "over" starts false; trimming at zero
  pressure is a bug, not a fallback.
- **Protected trimming**: user / approval / goal / assistant messages are NEVER
  trimmed; the marker enumerates what was dropped (kinds + tool callIds).
- **Drift loop is soft-only**: removed the early-trim (40%) and maxTokens-2048
  tightening from the drift escalation — wording compliance never takes
  priority over task completeness. Only the FIRST reasoning block of a message
  classifies (continuations never escalate).
- **Completeness clause**: brevity applies to reasoning, never to reporting —
  the final answer must include every confirmed fact; phase-1 anti-narration
  clause fixes the 1024-cap stall.
- **Round efficiency + depth rule**: batch tool calls in one round; shorten only
  redundant probing/narration, never synthesis.
- Honest A/B benchmark added (standard vs micro-inversion, 5 tasks × 2 presets).

# 2.0.0 (2026-08-24)

Global runtime mode (v2): the cold-start anchor becomes a persistent runtime
state — see `docs/v2-global-micro-inversion.md`.

- L1 cognitive persona: at promotion the phase-1 lean persona is swapped
  wholesale for the collective-execution-unit identity (identity reshaping,
  explicit CoT grammar, forbidden openers, self-check, anti-drift clause).
- L2 near-field anchor (`agent/pre-step`): every model request appends a
  constant "we need" reminder at the tail (max-attention position);
  escalation wording on detected drift.
- L3 result anchor (`tools/post-execute`): every accepted tool result attaches
  a constant continue-anchor via `additionalContexts` (harness-native
  result → next-request channel; no result-text mutation).
- D drift detection & re-anchoring loop: incremental `session.events` scan
  classifies every reasoning-block opener; violations escalate (re-assertion
  message, early middle trim below 80%, tighter output budget), recovery
  de-escalates.
- Acceptance: 10/10 PASS on a live session (bootstrap intact; L1 swap in
  promoted `request/header.system`; L2/L3 anchor `user/message` events in the
  durable log; post-promotion reasoning still opens "we need").

# 1.0.0 (2026-08-24)

Initial packaged release of the micro-inversion-standard agent preset
(微逆标准模式), extracted verbatim from the working install at
`~/.dsh/.agent-presets/micro-inversion-standard` (12/12 acceptance PASS
recorded in `preset/TEST.md`).

- Two-phase bootstrap: phase 1 exposes exactly the Minimal pair (persistent
  shell + `str_replace_editor`) with a 1024-token output cap and persona-only
  prompt sections; first durable tool call or first substantive reply promotes
  to the full Standard catalog in the same session; `compaction/end` resets to
  the controlled phase.
- Context slimming: `tools/post-execute` trims >8192-char results to
  head 4096 / tail 1024 and spills the full text (locator cited in marker);
  `agent/pre-step` replaces the middle message span with one constant marker
  at ≥80% of the routed model's context window.
- Packaging changes vs the working install:
  - `?v=2` → `?v=3` cache-busting stamp on both `.mjs` hook rows;
  - added `install.ps1` / `install.sh`, `README.md`, `LICENSE` (MIT,
    with dsh-anchored-standard attribution), `package.json` (private).
