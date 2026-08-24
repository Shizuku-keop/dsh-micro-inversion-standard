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
