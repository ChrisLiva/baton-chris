# Retro: baton/ccstatusline composition mode
**Date:** 2026-05-13

## Summary
Shipped baton/ccstatusline composition mode end-to-end: two new subcommands (`baton widget <name>`, `baton ccstatusline-setup`), an installer that detects ccstatusline ownership and points users at the setup helper, and supporting refactors (extracted `StatusJSON`, session-state helpers, `stripAnsi`, and `renderBatonBadgeStates`) so the standalone statusline and new widgets share render code. Tasks 1–10 shipped in commits `75b839d..20d77d2` on branch `crank/2026-05-13-ccstatusline-composition`. Full test suite (224 tests) and typecheck pass; `dist/cli.js` builds with the Node shebang.

## Deviations from the plan

- **Task 9 test assertion fix.** The plan's test asserted `expect(out).toContain("timeout: 3000")` against an output body that literally writes `"   timeout:       3000"` (multi-space alignment for readability). The two pieces of plan text were inconsistent. I kept the planned aligned output and softened the test to `toMatch(/timeout:\s+3000/)`. No behavior change; just a test that reflects the planned output format.

Other tasks ran clean — no plan changes needed for tasks 1–8 or task 10.

## Notes for future work

- The deferred `baton check` reporting line for composition mode (spec follow-up) was not addressed; `printCheckReport` already shows when the statusline is non-baton, so this can stay deferred until signal accumulates.
- Smoke tests in the plan (`Smoke tests for the user`) were not run as part of this execution — they require manual exercise inside a real ccstatusline session and a real Claude Code instance, plus a perf snapshot. Those remain pending and should be exercised before the PR is marked ready.
- No perf measurement was done in this execution (informational gate, not blocking). Worth running `time (echo '{}' | bun run src/cli.ts widget badge)` 5× on the dev machine before merging.

## Loose ends

- Manual smoke tests in ccstatusline TUI (per plan).
- Optional perf snapshot to validate the 3000ms timeout assumption.
- No code is left half-implemented; all planned files exist and exports are wired in.

## Validation evidence

- `bun run typecheck` → exit 0 (after each task and on final gate).
- `bun test` (full suite) → 224 pass, 0 fail across 21 files.
- `bun run build` → bundled 36 modules; `dist/cli.js` first line is `#!/usr/bin/env node`.
- Manual: `echo '{}' | bun run src/cli.ts widget badge` → exit 0, stdout `\n`.
- Manual: `bun run src/cli.ts ccstatusline-setup` → exit 0, prints the full setup block.
