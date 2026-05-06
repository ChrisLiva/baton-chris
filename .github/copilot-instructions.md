# GitHub Copilot Instructions

baton is a Claude Code plugin (published as `ccbaton` on npm) that snapshots session state into a structured `BATON.md` so a fresh `/clear` session can resume without context rot. It installs a statusline, three hooks (`UserPromptSubmit`, `PreCompact`, `SessionStart`), and `/baton`, `/drop`, `/baton-codex`, and `/baton-gemini` slash commands into `~/.claude/`.

## Dev Commands

```bash
bun install                                         # install deps
bun test                                            # run all tests
bun test test/tokens.test.ts                        # run a single test file
bun run build                                       # bundle to dist/cli.js (Node shebang, portable)
bun run typecheck                                   # tsc --noEmit
bun run src/cli.ts install                          # install from source into ~/.claude/
```

## Architecture

**Entry point:** `src/cli.ts` — dispatches subcommands: `statusline`, `hook <event>`, `install`, `check`, `uninstall`, `catch`, `drop`, `reconstruct`, `list`, `show`, `prune`, `recall`, `sidecar`. All subcommands read stdin or CLI args; none are interactive.

**Core modules:**

- `src/config.ts` — shared constants, paths (`userClaudeDir()`, `userSettingsPath()`), threshold values, `VERSION` (read from `package.json` via JSON import), and `buildCommand()` which generates self-locating hook commands pointing at the current install (source: `bun run`; published: `node`).
- `src/statusline/` — one-line status bar. `render.ts` orchestrates widgets; `widgets.ts` renders model, branch, baton badge, rate limit, duration, cost; `bar.ts` draws the context gauge; `color.ts` wraps ANSI codes.
- `src/hooks/` — one file per Claude Code hook event:
  - `user-prompt-submit.ts` — nudges Claude to `/baton` when context crosses soft/hard thresholds. At the hard threshold, injects the full baton protocol as `assistant_mdm`. Also fires a time-based nudge when session age ≥ 5 hours with ≥ 30k tokens in context (`SESSION_AGE_NUDGE_MS`, `SESSION_AGE_NUDGE_MIN_TOKENS`); the time nudge fires at most once per session via the `timeNudgeSent` flag in the state file.
  - `pre-compact.ts` — intercepts auto-compaction. If a fresh baton exists, blocks. Otherwise writes a fallback baton from the transcript, then blocks. Always outputs `{ decision: "block" }`.
  - `session-start.ts` — on `/clear` or resume, reads `BATON.md`, injects it as `additionalContext`, archives it so the resume is one-shot.
- `src/baton/` — baton lifecycle:
  - `archive.ts` — move baton to timestamped archive
  - `archive-library.ts` — `list`, `show`, `prune`, `recall` operations on the archive directory
  - `catch.ts` — CLI resume from nearest `BATON.md`
  - `drop.ts` — discard baton so `/clear` starts fresh
  - `fallback-writer.ts` — deterministic baton from transcript when `PreCompact` fires without a fresh baton
  - `find.ts` — walk up from cwd to locate nearest `BATON.md`
  - `reconstruct.ts` — rebuild a baton from a transcript JSONL file
  - `redact.ts` — strip secrets before sending to a sidecar; loads default patterns plus `~/.claude/.batonredact` and `.batonredact` project overrides
  - `state.ts` — read/write per-session state file
  - `template-loader.ts` — reads the `/baton` command template
- `src/sidecar/` — headless second-opinion runners for `/baton-codex` and `/baton-gemini`:
  - `run.ts` — shared orchestration: finds and redacts the baton, picks the host adapter, spawns the subprocess, streams output. Defines the `HostAdapter` interface (`binaryName`, `installHint`, `buildInvocation`).
  - `prompts.ts` — defines `SidecarMode` (`review` | `critique` | `alternative`), per-mode preambles, and `composePrompt()`.
  - `codex.ts` — `codexAdapter`: invokes `codex exec -c model_reasoning_effort=xhigh --sandbox read-only --ephemeral -`, prompt on stdin.
  - `gemini.ts` — `geminiAdapter`: invokes `gemini --prompt <prompt> --model pro --approval-mode plan` as argv.
- `src/transcript/` — `read.ts` parses JSONL transcripts; `tokens.ts` extracts token snapshots from the latest assistant usage entry.
- `src/install/settings-patch.ts` — patches `~/.claude/settings.json` idempotently: merges hooks, sets statusline, writes skill and command files, prunes stale entries, migrates old "handoff" artifacts. Backs up settings before modifying (collision-safe: appends numeric suffix if backup path already exists). Exports `check()` (read-only) and `uninstall()`.

**Build:** `scripts/build.ts` uses `bun build` targeting Node, replaces the shebang, copies `src/baton/template.md` to `dist/baton/template.md`.

## Key Design Decisions

- **Self-locating commands:** `buildCommand()` generates absolute paths so hooks survive `npx`/`bunx` exits. Source installs use `bun run .../cli.ts`; published installs use `node .../cli.js`.
- **Idempotent install:** `install()` is safe to run repeatedly — detects existing hooks by command string, prunes stale entries pointing at old paths, only writes files when content changed.
- **PreCompact always blocks:** The hook outputs `{ decision: "block" }` unconditionally — either a fresh baton exists, or a fallback was just written. It never returns `"allow"`.
- **Transcript format:** Claude Code transcripts are JSONL. Each line has `type`, `isSidechain`, `isApiErrorMessage`, and `message`. Only main-chain entries (not sidechain, not API errors) are used for token counting.
- **Token counting uses last assistant entry only:** The most recent main-chain assistant `usage` field represents current context size. Summing all entries would double-count cached tokens.
- **Freshness window:** `BATON_FRESH_MS` (default 10 min, configurable via env) gates whether `SessionStart` injects and whether `PreCompact` considers an existing baton sufficient.
- **State normalization:** The statusline writes `{ maxTokens }` to the state file without a `level` field. `readState()` in `user-prompt-submit.ts` normalizes missing/invalid `level` to `"none"` — without this, the soft nudge silently skips and users jump straight to the hard-stop.
- **Sidecar host adapter pattern:** `run.ts` defines `HostAdapter`; each host exports one adapter constant. Adding a new host requires only a new adapter file and a branch in `pickAdapter()` — no changes to shared orchestration.
- **Sidecar redaction:** `run.ts` redacts the baton body before constructing the prompt. Default patterns plus user and project override files are all applied. Redaction count is printed to stderr.
- **Backup collision avoidance:** `backup()` in `settings-patch.ts` appends an incrementing numeric suffix (e.g. `-1`, `-2`) if the timestamped backup path already exists, preventing silent overwrites when `install()` is called multiple times per second.

## Testing

Tests use Bun's built-in test runner. Test files live in `test/` and use temp directories via `mkdtempSync`. Fixtures in `test/fixtures.ts` generate synthetic JSONL transcripts. Helper utilities are in `test/helpers/`.

No mocking framework — tests write real files to temp dirs and invoke actual functions directly.

## Platform Notes

- Windows paths are normalized with `.replace(/\\/g, "/")` in `cliPath()` for shell compatibility.
- `chmod` in the build script is best-effort (no-op on Windows).
- `userHomeDir()` prefers `USERPROFILE` on win32, `HOME` otherwise.
