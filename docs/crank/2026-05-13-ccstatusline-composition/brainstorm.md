# baton/ccstatusline composition mode
**Date:** 2026-05-13 · **Status:** Brainstorm complete

## Context

Today baton's installer patches `~/.claude/settings.json` so `statusLine.command` runs `baton statusline`, which renders the whole line itself (`src/install/settings-patch.ts:141-165`, `src/statusline/render.ts:172-274`). Users who already use ccstatusline have to pick one tool or the other: baton's install warns and skips when another command owns the statusline, and the user has to choose `--force` (replace) or abandon baton's statusline entirely.

ccstatusline exposes a clean composition point: its `CustomCommand` widget pipes Claude Code's statusline JSON to a user-supplied shell command on stdin and uses stdout as widget text (`~/GitHub/ccstatusline/src/widgets/CustomCommand.tsx:57-71`). That's the same JSON `baton statusline` already consumes. So baton can become a *widget content provider* for ccstatusline while ccstatusline owns layout, separators, Powerline theming, and per-widget styling.

This brainstorm settles the contract, CLI surface, install behavior, and docs framing for that composition path.

## Key decisions

### Integration granularity

- **Options considered.**
  - A. Single composite `baton widget` subcommand emitting all baton bits in one line.
  - B. One subcommand per atomic widget, with an extensible namespace.
  - C. Hybrid.
- **Chose:** B.
- **Why:** ccstatusline's value is per-widget layout control (position, separator, Powerline caps, colors); a composite line forces baton's internal ordering and `│` separator into the middle of a layout the user is otherwise styling. Atomic widgets compose cleanly, and the dispatcher (`baton widget <name>`) is designed so adding new widget kinds later is one file plus one switch arm. C would mean two ways to do the same thing, which drifts in messaging and tests.

### Initial widget scope

- **Options considered.**
  - A. Badge only.
  - B. Badge + context-bar.
  - C. Badge + context-bar + future widgets up front.
- **Chose:** B with the namespace designed for future extension.
- **Why:** The BATON.md badge is genuinely unique content — nothing in ccstatusline knows about BATON.md presence, freshness (`BATON_FRESH_MS`), or the extracted goal title. The context bar overlaps with ccstatusline's `ContextBar`/`ContextPercentage` widgets, but baton's version is colored against the same soft/hard thresholds that drive the nudge hook (`src/hooks/user-prompt-submit.ts`), keeping the visual story consistent with nudge behavior. C would be design weight for hypothetical widgets; the namespace itself is the forward-compat hook.

### Widget input contract and error handling

- **Options considered.**
  - A. Always exit 0; emit empty string on any failure.
  - B. Exit 0 on "nothing to show," non-zero on real bugs.
  - C. Always exit 0; log diagnostics to stderr.
- **Chose:** C.
- **Why:** ccstatusline renders non-zero exits as `[Error]`/`[Timeout]` markers (`CustomCommand.tsx:83-103`), which is hostile in a statusline and trains users to ignore the widget. Silent fallback to empty (ccstatusline collapses empty widgets) is the right user-facing behavior. stderr keeps a debug channel for users who run the command manually; ccstatusline discards it (`stdio: ['pipe', 'pipe', 'ignore']`), so no noise in normal use. The line between "nothing to show" and "real bug" (e.g., a transient transcript-read race in `tokenTotalFromTranscript`) is too fuzzy to surface as a hard error.

### Color output

- **Options considered.**
  - A. Always emit ANSI; instruct users to enable ccstatusline's `preserveColors`.
  - B. Always emit plain text; let ccstatusline color the widget.
  - C. Per-invocation `--color` flag.
- **Chose:** C.
- **Why:** The badge's color is semantically load-bearing — a stale baton should look different from a fresh one. But Powerline/themed users who've styled a layout reasonably want flat text to color themselves. A flag lets each user pick at widget setup time. The setup assist defaults the recommendation to `--color` and explains the trade-off. Same flag governs both widgets initially; per-widget rules would be over-design.

### Setup assist mechanism

- **Options considered.**
  - A. Print-only `baton ccstatusline-setup` subcommand.
  - B. Direct edit of `~/.config/ccstatusline/settings.json`.
  - C. Print + opt-in `--apply` that writes.
- **Chose:** A.
- **Why:** ccstatusline's settings.json has a versioned Zod schema (`~/GitHub/ccstatusline/src/types/Settings.ts:9`, currently v3 with migrations from v1) owned by another tool; writing into it couples baton to their schema lifecycle. Layout is also user-curated (line choice, position, Powerline caps) — auto-appending "line 1, end" will be wrong for most polished setups. Print-only is one-way: no stale baton-written state to clean up later, no risk of clobbering through a schema bump. C's `--apply` path would be used rarely (polished-layout users won't trust auto-append; new users will paste anyway).

### Install behavior on detection

- **Options considered.**
  - A. Keep skip-and-warn; rewrite the warning to point at `baton ccstatusline-setup`.
  - B. Detect and silently switch to compose-mode (skip statusline patch, print setup instructions inline).
  - C. Interactive prompt to choose.
- **Chose:** A.
- **Why:** Install stays non-interactive (matching the rest of the CLI per `CLAUDE.md`) and behavior is unchanged — only the warning text gets ccstatusline-aware messaging. Detection is internal: regex against `settings.statusLine.command` matching `/(^|[\\/\s])ccstatusline(@|\s|$)/`, robust against `npx ccstatusline`, full bin paths, and pinned-version forms like `ccstatusline@2.2.16`. Hooks still install regardless. Composition is opt-in via the new subcommand, which keeps the install flow predictable. A user who has baton owning the statusline already and later installs ccstatusline would have to re-point ccstatusline manually then re-run `baton install`; we don't want to silently flip ownership behind their back.

### CLI surface naming

- **Options considered.**
  - A. `baton widget <name>` and `baton ccstatusline-setup`.
  - B. `baton ccwidget <name>` and `baton ccsetup` (host-prefixed).
  - C. `baton widget <name>` with `--setup-ccstatusline` flag.
- **Chose:** A.
- **Why:** The widget subcommand's contract (stdin Claude JSON → one line of widget text on stdout) is host-agnostic. If another host (Starship, P10k, etc.) shows up later, `baton widget badge` is reused unchanged and we add a new `baton <host>-setup`. Prefixing `widget` with `cc` would be premature taxonomy. C overloads one verb with two unrelated behaviors (one reads stdin, the other prints multi-line instructions).

### Width adaptation

- **Options considered.**
  - A. No width adaptation; ccstatusline's `maxWidth` does any trimming.
  - B. `--max-width N` flag using baton's smart truncation.
  - C. Auto-read a width hint from stdin JSON (no such field exists).
- **Chose:** B.
- **Why:** The standalone statusline's `renderBatonBadge(..., targetWidth)` (`src/statusline/widgets.ts`) already truncates the badge intelligently (drop goal title before freshness marker, etc.). ccstatusline's `CustomCommand` does blind `substring(0, N-3) + '...'` (`CustomCommand.tsx:79`), which cuts mid-word on the badge. Wiring a `--max-width` flag through to the existing logic is purely plumbing and gives users a better truncated badge than the default. C is a non-starter — no width signal exists in the JSON.

### Docs framing for standalone vs composed

- **Options considered.**
  - A. Co-equal paths in the README.
  - B. Composition is the headline; standalone stays as zero-config fallback.
  - C. Deprecate standalone over time.
- **Chose:** B.
- **Why:** Standalone is a real feature with real users — model + branch + cost in one zero-config install is valuable. But composition is strictly more flexible for anyone invested in their layout, and leading the README with it clarifies the architectural story: *baton produces baton-specific info; how you display it is your choice*. A bloats the README with two parallel setup paths; C is a direction-of-travel statement to defer until we see adoption.

## Open questions

- **`baton check` reporting.** Should `check` detect ccstatusline ownership and report "composed with ccstatusline" (and surface whether the user's ccstatusline settings reference our widget commands), or stay scoped to baton's own hooks/commands? Likely worth a small additive line in `printCheckReport`, but not a blocker.
- **Performance.** Composition means two extra subprocess spawns per Claude Code statusline tick (one per widget). Bun's cold start dominates per-invocation cost; the work inside is light. Probably negligible but worth measuring before announcing.

## Out of scope

- Writing into ccstatusline's `~/.config/ccstatusline/settings.json` from baton. Print-only setup keeps the schemas decoupled.
- Adding a third widget beyond `badge` and `context-bar`. The namespace allows it; we don't have a concrete next widget in the queue.
- Changing `baton install`'s skip-and-warn behavior, or any new interactivity. Install stays non-interactive.
- Deprecating standalone `baton statusline`. Stays as the zero-config fallback indefinitely.

## Summary

**What we're building:** A composition mode where baton emits its baton-specific content (BATON.md badge, threshold-colored context bar) through atomic `baton widget <name>` subcommands that read Claude Code's statusline JSON on stdin and emit one line of text on stdout. Users add these as ccstatusline `CustomCommand` widgets and let ccstatusline own layout, separators, and theming. A new `baton ccstatusline-setup` subcommand prints copy-paste-ready instructions for wiring everything up; baton's installer keeps its skip-and-warn behavior but, when it detects ccstatusline owns the statusline, rewords the warning to point users at the setup subcommand.

**Why:** Today baton clobbers or skips the statusline, forcing a one-or-the-other choice. Composition lets ccstatusline users keep their styled layout *and* surface BATON.md status without trade-offs, while keeping the standalone path intact for users who want zero-config.

**Rough next steps:**

- Carve a `src/widget/` module that exposes a dispatcher (`baton widget <name>`) and per-widget renderers; reuse `renderBatonBadge` / `renderBar` from `src/statusline/widgets.ts`.
- Add `--color` and `--max-width N` flags to the widget subcommand; default to no color, no truncation.
- Add `baton ccstatusline-setup` subcommand: prints the exact command strings, `preserveColors` toggle, and the TUI navigation steps for adding each widget.
- Add ccstatusline detection (regex on `statusLine.command`) to `patchStatusline` so the existing skip-and-warn message can point at the setup subcommand when appropriate.
- README: lead with composition as the recommended path; keep standalone documented as the zero-config option.
- Tests: temp-dir-based, no mocking (matches existing style). Cover dispatcher, both widget renderers with representative stdin payloads, the setup-subcommand output, and the install-time warning text under both detection states.
