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
