# baton/ccstatusline composition mode
**Date:** 2026-05-13 · **Status:** Spec — ready for plan · **Brainstorm:** [./brainstorm.md](./brainstorm.md)

## Updates since brainstorm

- **Badge idle behavior pinned to empty.** `baton widget badge` returns an empty string (and stdout is `\n`) when no fresh `BATON.md` is present and no `soft`/`hard` nudge level is set for the session — ccstatusline collapses empty widgets, so the badge appears only when there is a real baton story to tell. The standalone `renderBatonBadge` keeps its current idle fallback (`→125k` threshold marker); the divergence is intentional.
- **Shared session-state writes are required, not optional.** `persistStateSnapshot` and `tokenTotalFromTranscript` move out of `src/statusline/render.ts` into a new shared module so the widget dispatcher writes the same per-session state file the standalone statusline does. Without this, a user who fully composes via ccstatusline (no standalone `baton statusline` running) would have a degraded `UserPromptSubmit` nudge hook — it reads `maxTokens` and `rateLimit5hPct` out of that state file (`src/hooks/user-prompt-submit.ts`).
- **Detection regex tightened.** Brainstorm's `/(^|[\\/\s])ccstatusline(@|\s|$)/` misses path-style invocations like `node /path/to/ccstatusline/dist/index.js`. Use `/(^|[\\\/\s])ccstatusline([@\s\\\/]|$)/i` (case-insensitive, slashes in both boundaries).
- **Performance budget made explicit.** Setup assist will recommend `timeout: 3000` for ccstatusline's per-widget exec timeout (default is 1000ms; Bun cold start in source-mode installs measured during plan/execute against the validation budget). Published Node installs are well under 1000ms; source-mode installs can spike past that.

## Goals & non-goals

**Goals**
- Let ccstatusline users add baton-specific information (BATON.md badge, threshold-colored context bar) as ccstatusline `CustomCommand` widgets, keeping ccstatusline as owner of layout, separators, and theming.
- Keep `baton install` non-interactive and idempotent. Hooks/slash-commands install regardless of statusline ownership; only the statusline-skipped warning message changes when ccstatusline is detected.
- Keep the standalone `baton statusline` path working unchanged for users who want zero-config.
- Set up the widget namespace (`baton widget <name>`) so adding future widgets is a per-file extension, not a redesign.

**Non-goals**
- Writing into ccstatusline's `~/.config/ccstatusline/settings.json`. Print-only setup keeps the schemas decoupled.
- Adding a third widget beyond `badge` and `context-bar` (the namespace allows it; no concrete next widget is in the queue).
- Deprecating standalone `baton statusline`.
- Auto-switching install mode based on detection — install stays non-interactive and stays in its current skip-and-warn flow.

## Technical approach

### Subcommand surface

Add two subcommands to `src/cli.ts` (the dispatch switch at `src/cli.ts:76`):

- `baton widget <name> [--color] [--max-width N]` — reads Claude Code's statusline JSON on stdin, writes one line of widget text to stdout, **always exits 0**, writes diagnostics to stderr. `<name>` ∈ {`badge`, `context-bar`}; unknown names log to stderr and emit empty. Unknown flags log to stderr and are ignored.
- `baton ccstatusline-setup` — prints copy-paste-ready setup instructions to stdout and exits 0. No stdin. No flags initially.

Both are added to the `usage()` text in `src/cli.ts:30-66` under "Internal" (for `widget`) and the public list (for `ccstatusline-setup`).

### Widget module layout

New directory `src/widget/`:

```
src/widget/
  dispatch.ts          # entry — switches on <name>, reads stdin JSON, parses flags
  badge.ts             # renderBadgeWidget(json, opts)
  context-bar.ts       # renderContextBarWidget(json, opts)
  flags.ts             # parseWidgetFlags(argv) -> { color, maxWidth }
  json.ts              # StatusJSON type alias + safe-parse helper (shared with render.ts)
```

- `dispatch.ts` exports `async function runWidget(name: string, argv: string[], raw: string): Promise<void>`. It always resolves; never throws to the caller. Top-level try/catch around the renderer call. On any caught error, writes `baton widget <name>: <message>` to stderr and emits empty stdout.
- `badge.ts` and `context-bar.ts` re-use `renderBatonBadge` (`src/statusline/widgets.ts:86`) and `renderBar` (`src/statusline/bar.ts:38`) verbatim — no signature changes — and adapt around the idle policy and color/width plumbing.
- Module-level imports stay flat (no dynamic import). The dispatcher is the only public boundary; widget files don't import each other.

### Session-state extraction

Move two helpers out of `src/statusline/render.ts` (currently lines 104-170) into a new shared module:

```
src/statusline/session-state.ts
  - persistStateSnapshot(sessionId, { maxTokens?, rateLimit5hPct? })
  - tokenTotalFromTranscript(path) -> number
```

The `StatusJSON` interface (currently module-private in `render.ts:19-41`) moves to a new shared file `src/statusline/status-json.ts` and is imported by both `render.ts` and `src/widget/dispatch.ts`. `status-json.ts` is the canonical owner; `render.ts` adds an import line and drops its private definition.

Both helpers keep module-level caches (`cachedSnapshot`, `lastPersistedSnapshot`) co-located with their function. Note: these caches are **per-process**, not shared between the standalone-statusline process and the widget process — each is spawned fresh per Claude Code statusline tick, so the cache only dedupes within a single invocation (which is the correct scope; the extraction goal is shared *code*, not shared state).

Both widgets call `persistStateSnapshot` on every invocation **when `session_id` is present in the JSON AND at least one of `maxTokens` or `rateLimit5hPct` is resolvable** (matching `persistStateSnapshot`'s existing early-return guard at `render.ts:125`). A minimal stdin payload with only `session_id` writes nothing — the state file might not exist after such an invocation. The order of operations inside the widget dispatcher is fixed: parse JSON → call `persistStateSnapshot` (merges `maxTokens`/`rateLimit5hPct` into the existing state file, preserving `level` and `timeNudgeSent`) → call the widget renderer (which reads `level` from the same file). Persist-before-read is safe because the persist path never writes `level`.

### Badge widget contract

`baton widget badge` reads `cwd` and `session_id` from JSON, then:

1. **Fresh baton present?** (cwd `.claude/baton/BATON.md` exists, `Date.now() - mtimeMs < BATON_FRESH_MS`) → emit the fresh-baton output (delegated to `renderBatonBadgeStates`, which calls the same fresh-rendering path the current `renderBatonBadge` uses).
2. **Nudge level `hard`?** (state file `<sessionId>.json` has `level === "hard"`) → emit `⚠ HARD`.
3. **Nudge level `soft`?** → emit `⚠ soft`.
4. **Otherwise** → emit empty string (the widget writes exactly `"\n"` to stdout; ccstatusline calls `.trim()` then `output || null` on the result and collapses null widgets — verified against `CustomCommand.tsx:64-70`).

Refactor `renderBatonBadge` in `src/statusline/widgets.ts:86-122` to delegate to a new sibling helper:

```ts
// New, exported.
export function renderBatonBadgeStates(
  cwd: string | undefined,
  sessionId: string | undefined,
  max?: number,                  // defaults to DEFAULT_MAX_TOKENS = 200_000
  maxWidth?: number,
): string | null;                 // null = idle (no fresh baton, no nudge)

// Existing, signature unchanged — call sites in render.ts:212 and render.ts:262 stay as-is.
export function renderBatonBadge(
  cwd: string | undefined,
  sessionId: string | undefined,
  max: number = DEFAULT_MAX_TOKENS,
  maxWidth?: number,
): string {
  return renderBatonBadgeStates(cwd, sessionId, max, maxWidth)
    ?? color.blue.dim(`→${formatK(Math.round(THRESHOLDS.ORANGE_MAX * max))}`);
}
```

Standalone behavior is byte-identical to today; the only change is that the four-state logic is reachable from the widget dispatcher.

Flags:
- `--color` → pass through ANSI from the `color.*` helpers. Absent → strip ANSI using a new exported `stripAnsi(s: string): string` added to `src/statusline/color.ts` (one-liner: `s.replace(ANSI_RE, "")` against the already-defined `ANSI_RE`). Do not invent a `visibleText` name — `visibleLength` returns a number; we need a sibling `stripAnsi` that returns a string.
- `--max-width N` (integer, > 0) → forwarded to `renderBatonBadge`'s existing `maxWidth` parameter (total visible width including the `BATON: ` prefix; this is the same semantic the standalone statusline uses via `targetWidth`). When N ≤ `MIN_BATON_GOAL_BADGE_WIDTH` (= 8 in `widgets.ts:40`), `renderFreshBatonBadge` already falls back to `BATON ✓` — no extra handling needed in the widget. Invalid N (non-integer or ≤ 0) → stderr diagnostic, treat as unset.

Max-tokens source for the threshold computation: pull from `context_window.context_window_size` if present, else `DEFAULT_MAX = 200_000` — same logic as `render.ts:180-181`.

**Env var note (BATON_FRESH_MS):** ccstatusline's `CustomCommand.tsx:69` spawns the widget with `env: process.env`, which forwards the parent environment. So `BATON_FRESH_MS` set in the user's Claude Code launch environment reaches the widget unchanged. No special handling required.

### Context-bar widget contract

`baton widget context-bar` reads `context_window.used_percentage`, `context_window.context_window_size`, and `transcript_path` from JSON, computes tokens via the same fall-back chain as `render.ts:197-203`, then calls `renderBar(tokens, max, barCells)` **verbatim** — no new threshold logic in the widget; zone selection and the `⚠ BATON NOW` red marker come from `renderBar`/`zoneFor` in `src/statusline/bar.ts:38-69`, gated on `THRESHOLDS.ORANGE_MAX` (= 0.625, i.e. 62.5% of the context window).

Flags:
- `--color` → same semantics as badge (uses the new `stripAnsi`).
- `--max-width N` (integer, > 0) → maps to `renderBar`'s `width` parameter (= number of bar cells, **not** total visible width). Total visible width is approximately `N + 1 + labelLen` (label is `<tokens>k/<max>k`, ~10 chars). When N is unset → use the default `width = 12`. When N < 3 → stderr diagnostic, fall back to default. (Rationale: keeping the meaning of N aligned with the existing `renderBar(width)` signature avoids label-width arithmetic the user can't predict at setup time. For a hard total cap, the user can also set ccstatusline's own per-widget `maxWidth` — but the setup subcommand recommends leaving that blank to avoid double-truncation.)

Edge cases:
- `tokens === null` (no transcript and no `used_percentage`) → emit empty so widget collapses. (Standalone renders the dim placeholder `░░░░░░░░░░░░ --/--`; in widget mode that's noise alongside ccstatusline's own context widgets.)

### Setup subcommand output

`baton ccstatusline-setup` prints a single self-contained block to stdout (plain text with ANSI dim/bold for headers, gated on `process.stdout.isTTY`). Structure:

```
baton + ccstatusline composition

Two baton widgets to add to ccstatusline:

1. Baton badge — shows BATON.md goal when fresh, or ⚠ soft / ⚠ HARD when nudges have fired.

   Command path:  <buildCommand("widget badge --color --max-width 40")>
   maxWidth:      <leave blank — badge is already sized via --max-width>
   timeout:       3000
   preserveColors: ON

   (--max-width 40 covers `BATON: ` (7 chars) + ~32 chars of goal title before
   ellipsis; this matches the standalone statusline's default goal budget.)

2. Baton context-bar — colored against baton's soft/hard thresholds (the same ones that drive nudges).

   Command path:  <buildCommand("widget context-bar --color --max-width 12")>
   maxWidth:      <leave blank — bar is already sized via --max-width>
   timeout:       3000
   preserveColors: ON

How to add each one in ccstatusline:

  1. Run `ccstatusline` in a terminal.
  2. Use the TUI to add a Custom Command widget on the line/position you want.
  3. Paste the command path above into the command field.
  4. Press `t` to set timeout to 3000.
  5. Press `p` to turn ON preserveColors (so baton's threshold colors render).
  6. Save and exit.

Both widgets read Claude Code's statusline JSON on stdin and emit one line on
stdout. They always exit 0; on error, stderr gets a diagnostic and stdout is
empty (the widget collapses). Drop `--color` from the command path if you'd
rather have ccstatusline's per-widget color settings paint the output.

If you have not yet pointed ccstatusline at Claude Code:
  Set `statusLine.command` in ~/.claude/settings.json to `ccstatusline`
  (or your preferred invocation form), then re-run `baton install`.
```

Exact wording can vary; what matters is that every value above (command strings, `timeout`, `maxWidth`, `preserveColors`, TUI keybinds) is present. Command strings are constructed via `buildCommand(...)` from `src/config.ts:121` so they self-locate to the current install.

### Install-time detection

`patchStatusline` in `src/install/settings-patch.ts:141-165` keeps its current control flow (return early with `skipped` when a non-baton command owns the statusline). Add a single helper, **exported** so the regex can be unit-tested directly:

```ts
export function isCcstatuslineCommand(cmd: string | undefined): boolean {
  if (!cmd) return false;
  return /(^|[\\\/\s])ccstatusline([@\s\\\/]|$)/i.test(cmd);
}
```

When the existing command matches `isCcstatuslineCommand` and `force` is false, the `skipped` reason becomes:

```
existing statusLine.command is "ccstatusline" — leaving it in place.
Run `baton ccstatusline-setup` for steps to add baton's widgets to ccstatusline,
or re-run `baton install --force` to replace it with baton's statusline.
```

The original generic warning is kept for any other non-baton statusline command. No interactivity; no behavior change beyond the message.

### `KNOWN_SUBCOMMANDS` and `isBatonCommand`

Add `"widget"` and `"ccstatusline-setup"` to `KNOWN_SUBCOMMANDS` in `src/install/settings-patch.ts:27-36`. Neither will appear in `settings.hooks` in practice (widgets live in ccstatusline's settings, not Claude Code's), but keeping the list complete protects against a user pasting a baton invocation into a non-statusline hook by accident and the prune logic accidentally treating it as foreign.

`isBatonCommand` uses prefix-matching (`cmd === \`baton widget\`` or `cmd.startsWith(\`baton widget \`)`), so this match is broad on purpose: `baton widget badge`, `baton widget context-bar`, and any future `baton widget <name>` are all baton-owned. Narrowing to known sub-names would force a `KNOWN_SUBCOMMANDS` edit every time a widget is added.

### README rewrite

- New top-level section `## Statusline` becomes a two-mode section:
  1. **Composed with ccstatusline (recommended)** — short paragraph + a "run `baton ccstatusline-setup`" call-to-action.
  2. **Standalone** — keep the existing screenshot/text as the zero-config fallback.
- The current `## Statusline` section's content (`README.md:63-73`) is preserved verbatim under the "Standalone" subhead; the composition subhead leads.
- No new screenshot; the existing one still represents standalone.

### Build & packaging

`scripts/build.ts` already bundles `src/cli.ts` via `bun build --target=node`. The new files under `src/widget/` and `src/statusline/session-state.ts` are reachable from `cli.ts`, so they get bundled automatically — no changes needed. No new bundled assets (no template files for these subcommands).

`package.json` `description` does not need to change.

## Interfaces & contracts

### Stdin (both widgets)

Same shape as `src/statusline/render.ts:19-41`'s `StatusJSON`. Both widgets tolerate missing fields without crashing. Malformed JSON → empty stdout + stderr diagnostic.

### CLI surface

```
baton widget <name> [--color] [--max-width N]
  name: "badge" | "context-bar"
  --color:       emit ANSI escapes (default: stripped, plain text)
  --max-width N: per-widget; semantics differ per widget (see Technical approach)
  stdin:         Claude Code statusline JSON (utf-8)
  stdout:        one line of widget text, terminated by '\n'
                 (empty line when widget has nothing to show)
  stderr:        diagnostics (parse errors, unknown name/flag, invalid values)
  exit code:     always 0

baton ccstatusline-setup
  stdin:         ignored
  stdout:        setup instructions (TTY-aware ANSI for headers)
  exit code:     0
```

### New exports

```ts
// src/statusline/session-state.ts
export function persistStateSnapshot(
  sessionId: string,
  snapshot: { maxTokens?: number; rateLimit5hPct?: number },
): void;
export function tokenTotalFromTranscript(path: string): number;

// src/statusline/widgets.ts
// Existing renderBatonBadge keeps its signature.
// New internal helper exposed for the widget:
export function renderBatonBadgeStates(
  cwd: string | undefined,
  sessionId: string | undefined,
  max?: number,
  maxWidth?: number,
): string | null; // null = idle (no fresh baton, no nudge)

// src/widget/dispatch.ts
export async function runWidget(name: string, argv: string[], raw: string): Promise<void>;

// src/install/settings-patch.ts
export function isCcstatuslineCommand(cmd: string | undefined): boolean;
```

## Blast radius

**Modified files**

- `src/cli.ts` — add `widget` and `ccstatusline-setup` cases to the switch (`src/cli.ts:76`); add usage entries.
- `src/statusline/render.ts` — drop the inlined `persistStateSnapshot` and `tokenTotalFromTranscript`; import them from the new module. No behavioral change.
- `src/statusline/widgets.ts` — extract `renderBatonBadgeStates` as described; `renderBatonBadge` body becomes a one-liner over it.
- `src/install/settings-patch.ts` — add `isCcstatuslineCommand` helper; reword `patchStatusline`'s skipped-reason for the ccstatusline case; extend `KNOWN_SUBCOMMANDS`.
- `README.md` — restructure the `## Statusline` section as described.

**Added files**

- `src/statusline/session-state.ts` — extracted helpers (above).
- `src/widget/dispatch.ts`, `src/widget/badge.ts`, `src/widget/context-bar.ts`, `src/widget/flags.ts`, `src/widget/json.ts` — new widget module.
- `test/widget.test.ts` — covers the dispatcher, both widgets (fresh / soft / hard / idle / invalid JSON / missing cwd), flag parsing, max-width edge cases, state-file write side effect.
- `test/ccstatusline-setup.test.ts` — covers the setup-subcommand output (asserts the command strings, `timeout: 3000`, `preserveColors`, and the TUI step list are all present).

**Deleted files**

- None.

**Public API changes**

- New CLI subcommands `widget` and `ccstatusline-setup`. No existing subcommand changes shape.
- New exports `persistStateSnapshot`, `tokenTotalFromTranscript`, `renderBatonBadgeStates`, `runWidget` — none have current external consumers (grep-verified: `persistStateSnapshot` and `tokenTotalFromTranscript` are module-private to `render.ts`; `renderBatonBadgeStates` is new; `runWidget` is new).

**Cross-cutting**

- No migrations, no env vars, no settings-schema bumps.
- No CI changes.
- `~/.claude/baton/state/<sessionId>.json` write surface unchanged — same paths, same fields. Composition users will simply see those files get written by the widget process instead of (or in addition to) the standalone statusline process.

**Tests affected**

- Existing tests touching `renderBatonBadge`, `renderBar`, `renderStatusline`, `install`/`uninstall` should be unchanged (grep-verified: no signature changes). The install test at `test/uninstall.test.ts:41` that uses `"ccstatusline"` as a pre-existing statusline command will exercise the new reworded skip message *if* an assertion is added; otherwise it's unaffected by behavior since detection only changes the warning text.
- `test/install.test.ts` does not currently assert on the skip-warning text; one new test should pin the rewording.

**Reversibility**

- *Trivial revert.* No on-disk schema changes. Users who configured ccstatusline `CustomCommand` widgets pointing at `baton widget ...` would see those commands return non-zero (`Unknown subcommand` / exit 2) after revert — which ccstatusline renders as `[Exit: 2]` per `CustomCommand.tsx:99-100`. Document this in the PR description but it's a soft-edge, not a backfill requirement.

## Size & risk

- **Size: M** — 3 modified source files, ~5 new source files, 2 new test files, ~300-500 LOC total including tests. No migrations.
- **Risk: low** — additive. The two existing behaviors that *could* regress (standalone statusline rendering, state-file writes feeding the nudge hook) both flow through extracted helpers that keep their public shape; tests already cover them. Highest-risk move is the `renderBatonBadge` → `renderBatonBadgeStates` extraction, but it's a mechanical rearrangement around an idle-fallback return.

## Validation

### Agent-verifiable

- [ ] Type-check passes — `bun run typecheck` → exit 0.
- [ ] Full test suite passes — `bun test` → exit 0, "0 fail" in summary.
- [ ] Widget badge: fresh baton emits goal — `echo '{"cwd":"<tmp>","session_id":"s1","context_window":{"context_window_size":200000}}' | bun run src/cli.ts widget badge --color` with a `.claude/baton/BATON.md` containing `## Current Goal\nDo the thing` → stdout matches `/BATON.*Do the thing/`, exit 0.
- [ ] Widget badge: idle emits empty — same invocation without `BATON.md` and without state file → stdout is exactly `\n`, exit 0.
- [ ] Widget badge: hard nudge — state file `<sessionId>.json` containing `{"level":"hard"}` → stdout contains `⚠ HARD`, exit 0.
- [ ] Widget badge: `--color` strips when absent — same fresh-baton fixture without `--color` → stdout does not match `/\x1b\[/`.
- [ ] Widget badge: `--max-width 12` truncates — long goal in `BATON.md`, run with `--max-width 12` → `stripAnsi(stdout.trimEnd()).length ≤ 12` (strip ANSI first, drop the trailing `\n`).
- [ ] Widget badge: malformed JSON — `echo 'not json' | bun run src/cli.ts widget badge` → stdout is `\n`, stderr contains `baton widget badge:`, exit 0.
- [ ] Widget context-bar: renders bar — JSON with `used_percentage: 30` and `context_window_size: 200000` → stdout contains a `█` and a `/` (label separator).
- [ ] Widget context-bar: red-zone warning — `used_percentage: 70` → stdout contains `⚠ BATON NOW`.
- [ ] Widget context-bar: no tokens → empty — JSON with no `used_percentage` and no `transcript_path` → stdout is exactly `\n`.
- [ ] Widget unknown name — `bun run src/cli.ts widget bogus` → stdout `\n`, stderr contains `unknown widget`, exit 0.
- [ ] State file written — running either widget with a fresh `session_id` and `context_window_size` populated → `~/.claude/baton/state/<sessionId>.json` exists with `maxTokens` field. (Test fixture redirects `HOME` like existing tests.)
- [ ] Setup subcommand prints expected blocks — `bun run src/cli.ts ccstatusline-setup` → stdout contains all of: `widget badge`, `widget context-bar`, `timeout: 3000`, `preserveColors`, `Run \`ccstatusline\` in a terminal`, exit 0.
- [ ] Install warning rewrites for ccstatusline — seed `settings.json` with `statusLine.command: "ccstatusline"`, call `install()`, assert `report.skippedStatuslineReason` contains `baton ccstatusline-setup`.
- [ ] Install warning unchanged for non-ccstatusline — seed `statusLine.command: "starship"`, call `install()`, assert `report.skippedStatuslineReason` does NOT contain `baton ccstatusline-setup` and does contain `--force`.
- [ ] Detection regex catches forms — direct unit test on the exported `isCcstatuslineCommand` covering: `"ccstatusline"`, `"npx ccstatusline@2.2.16"`, `"node /usr/lib/ccstatusline/dist/index.js"`, `"bun run ccstatusline"`, `"echo ccstatusline-not-real"` (negative), `"my-ccstatusliner"` (negative).
- [ ] Build still works — `bun run build` → `dist/cli.js` exists and starts with `#!/usr/bin/env node`.
- [ ] Standalone statusline unchanged — `echo '<existing fixture>' | bun run src/cli.ts statusline` → output byte-identical to current behavior for at least one snapshot in `test/statusline.test.ts` (no new assertions needed; existing tests pass).

### Requires user testing

- [ ] **Visual end-to-end in a real ccstatusline session.** Install baton, install ccstatusline, run `baton ccstatusline-setup`, follow the printed instructions in the ccstatusline TUI to wire both widgets, restart Claude Code, open a session, write a short BATON.md. Look for: badge appears with the goal, threshold-colored context bar appears alongside ccstatusline's own widgets without layout breakage, Powerline caps (if user has them) render cleanly around baton's widgets.

### Informational (not gating)

- [ ] **Perf snapshot.** `time (echo '{}' | bun run src/cli.ts widget badge)` measured 5×; expectation is max wall time < 3000ms on the dev machine. If exceeded on macOS/Linux/Windows, raise the recommended `timeout` in the setup subcommand or steer composition users to the published Node build (`npm install -g ccbaton`). Captured in the PR description, not a CI gate.

## Open questions

- **`baton check` reporting for composition.** Brainstorm flagged this as additive ("composed with ccstatusline" line in `printCheckReport`). Deferred to a follow-up — not load-bearing for the composition path itself, and the current check report already shows when the statusline is non-baton.
- **`Assumption:` baton's source-mode Bun cold start fits inside 3000ms on supported platforms.** Invalidated by: a measured run exceeding 3s on macOS/Linux/Windows during the perf-budget validation. If invalidated, either (a) raise the recommended timeout further in the setup subcommand, or (b) recommend the published Node build (`npm install -g ccbaton`) for composition users.
- **`Assumption:` ccstatusline's `CustomCommand` widget contract (`stdin = JSON; stdout = text; exit 0 = ok; non-zero → "[Error]"`) stays stable through ccstatusline's next minor release.** Invalidated by: a ccstatusline release that changes the JSON-on-stdin contract or the per-widget exec model. If invalidated, revisit the dispatcher's stdin parser.

## Out of scope

- Writing into `~/.config/ccstatusline/settings.json` from baton.
- Adding widget types beyond `badge` and `context-bar`.
- Changing `baton install` interactivity or `--force` semantics.
- Deprecating standalone `baton statusline`.
- A `--apply`-style auto-wire-into-ccstatusline flag.

## Review log

Reviewer: Sonnet, adversarial pass · Date: 2026-05-13

### Adopted

- Persist-vs-read ordering in the widget dispatcher → pinned order (parse JSON → `persistStateSnapshot` → renderer) and noted that the persist path never writes `level`, so persist-before-read is safe.
- Per-process cache lifetime → clarified that `cachedSnapshot`/`lastPersistedSnapshot` are per-process; extraction shares code, not state.
- stdout-bytes for empty widget → spec now states the widget writes exactly `"\n"`, and references `CustomCommand.tsx:64-70`'s `output.trim() || null` collapse path.
- Red-zone threshold provenance → spec says `renderBar` is called verbatim; red zone comes from `THRESHOLDS.ORANGE_MAX = 0.625`.
- `renderBatonBadge` signature preserved → spec now shows the wrapper explicitly with `max: number = DEFAULT_MAX_TOKENS` and confirms call sites at `render.ts:212` and `render.ts:262` need no edits.
- `BATON_FRESH_MS` env forwarding → noted that ccstatusline's `CustomCommand.tsx:69` forwards `process.env`, so the env override works in composition.
- Widget `--max-width` vs ccstatusline `maxWidth` coordination → setup subcommand now recommends "leave blank" for ccstatusline's own `maxWidth` on both widgets.
- `isCcstatuslineCommand` testability → spec exports the helper so the regex unit test can call it directly.
- `StatusJSON` canonical owner → moved to a new shared `src/statusline/status-json.ts`; `render.ts` imports it (added to the modified-files list implicitly via the existing `render.ts` change).
- Badge `--max-width 40` default → spec now annotates the rationale (`BATON: ` prefix + ~32 chars of goal title), matching the standalone statusline's `DEFAULT_BATON_GOAL_MAX` budget.
- `persistStateSnapshot` conditional-write phrasing → spec now states "when `session_id` is present AND at least one of `maxTokens`/`rateLimit5hPct` is resolvable," matching the existing early-return.
- `stripAnsi` naming → spec mandates a new exported `stripAnsi(s)` in `src/statusline/color.ts` (alongside the existing `visibleLength`/`ANSI_RE`); the widget imports it instead of inventing a `visibleText`.
- Visible-length measurement for max-width validation → validation item now says `stripAnsi(stdout.trimEnd()).length ≤ 12`.
- Perf-budget validation status → moved out of "Agent-verifiable" into a new "Informational (not gating)" sub-section so the pass criterion is unambiguous.

### Considered, not adopted

- Narrow `KNOWN_SUBCOMMANDS` to specific widget names (`baton widget badge`, `baton widget context-bar`) — rejected. The prefix match `baton widget ` covers all current and future widgets without per-widget edits, which is the point of the namespace. Spec now states this is intentional.

### Open items

- None — no reviewer concern required additional user input.
