# DEV.md

This is a working development backlog for baton. It is intentionally opinionated:
baton should stay small, local-first, deterministic, and boring in the places
where it touches user settings or session recovery.

## Product Direction

baton already covers the core loop:

- install Claude Code hooks, statusline, and slash commands
- nudge before context pressure or rate-limit pressure makes a clean handoff hard
- block auto-compaction and write a fallback baton when needed
- resume once from a fresh `BATON.md`, then archive it
- recover with `catch`, `reconstruct`, archive listing, search, and pruning
- redact deterministic fallback batons
- get a second opinion via headless Codex or Gemini sidecars (`/baton-codex`, `/baton-gemini`) without leaving the session

The next useful work should improve confidence in those handoffs before adding
larger features. A bad baton is worse than no baton because the next session is
explicitly instructed to trust it.

## Recommended Next PR: `baton validate`

Add a deterministic validator for `BATON.md`.

### Why

The highest-risk user experience is not installation. It is a baton that exists
but is too vague, missing the next action, missing files, or accidentally
contains a secret. The current `/baton` template asks Claude to write a good
handoff, but there is no local check that the result is actually usable.

### Proposed CLI

```bash
baton validate                 # validates .claude/baton/BATON.md
baton validate path/to/BATON.md
baton validate --json
baton validate --strict
```

Exit codes:

- `0`: valid
- `1`: invalid baton
- `2`: usage or unreadable file

### Validation Rules

Initial rules should be simple and deterministic:

- required headers are present exactly once
- `Current Goal` is not empty, `_none_`, or `_unknown_`
- `Next Concrete Action` is not empty, `_none_`, or generic filler like
  "continue the work"
- `Active Work` includes `What`, `Where`, `Why`, and `State`
- `State` is one of `Unstarted`, `edited-not-tested`, `tested-failing`,
  `tested-passing`, or `blocked`
- `Recent Test / Build State` names a command or explicitly says no command ran
- code references in `Completed This Session`, `Active Work`, and `Key Files`
  should look like paths, preferably with line numbers
- default and user/project redaction patterns are scanned and reported

`--strict` can fail on weaker heuristics, such as missing line numbers, too many
unknown fields, or an overlong `Recent Turns` section from a fallback baton.

### Template Integration

Update the `/baton` command template so after writing the file it runs:

```bash
baton validate .claude/baton/BATON.md
```

If validation fails, Claude should fix the baton once and run validation again.
The command should still stop after the baton is valid, preserving the existing
"do not continue new work after writing" behavior.

### Implementation Sketch

- Add `src/baton/validate.ts`.
- Reuse redaction pattern loading from `src/baton/redact.ts`.
- Add a `validate` branch to `src/cli.ts`.
- Keep output terse for humans and structured for `--json`.
- Add tests for valid baton, missing sections, weak next action, invalid state,
  and secret-like content.

## Other Feature Candidates

### `baton status`

Show project-local handoff state without requiring Claude Code's statusline
payload:

- current `BATON.md` path, age, and freshness
- parsed current goal
- latest archive for this project
- install health summary
- state file nudge level if a session id is provided

This would be useful for debugging and for users who want a normal shell command
before deciding whether to `/clear`, `/drop`, or `catch`.

### `baton check --json`

The existing `check` is useful but human-oriented. JSON output would make it
easier to write issue templates, bug reports, scripts, or CI smoke checks.

The shape can mirror `CheckReport` from `src/install/settings-patch.ts`.

### Install Dry Run

Add:

```bash
baton install --dry-run
```

It should print what would change in `settings.json`, commands, and stale
artifacts without writing anything. This is mostly an open-source trust feature:
users are rightly cautious about a package that patches editor-agent settings.

### Config File

Today most tuning is constants or environment variables. A future config file
could support:

- threshold overrides
- statusline widget selection
- freshness window
- archive retention defaults
- strict validation defaults

Do this after `validate` and `check --json`, because config multiplies the
number of behavioral combinations that need tests.

### Archive Improvements

The archive is already useful. Next increments:

- `baton pin <id>` so prune never deletes important batons
- `baton recall --project <name>`
- `baton show --json` for tooling
- include validation status in `list`

### Post-Write Scrub

Fallback batons are redacted today; Claude-authored `/baton` files are not. A
validator can warn first. Later, a separate `baton scrub` command could rewrite
a baton with redactions applied, but it should be opt-in because rewriting
Claude-authored prose can hide useful context.

## Cleanup Candidates

### Split `settings-patch.ts`

`src/install/settings-patch.ts` owns settings mutation, artifact writing,
migration, uninstall, check, and reporting. It is well-tested but large.

Possible split:

- `settings.ts`: parse, backup, statusline patching, hook merge/prune
- `artifacts.ts`: command files, old artifact migration, ownership checks
- `manifest.ts`: install manifest read/write
- `report.ts`: terminal output
- `settings-patch.ts`: orchestration only

This should be done after the current installer cleanup lands, not in the same
PR as a feature.

### Centralize Baton Freshness

`isFresh` logic appears in multiple hook files and the statusline checks similar
state. Move freshness calculation into a small `src/baton/freshness.ts` helper
that returns `{ exists, fresh, ageMs }`.

That helper would also support `baton status`.

### Centralize CLI Parsing

`src/cli.ts` is still readable, but new commands will make manual argument
parsing more fragile. Avoid a dependency for now; a small local helper for
flags, positional args, and usage errors is enough.

### Output Consistency

Use the same conventions across commands:

- `--json` means no ANSI and stable fields
- `--dry-run` never writes
- command failures include the path that failed
- validation-style commands use exit `1` for an expected failed check and `2`
  for bad usage

### Statusline UI Polish

Current statusline is compact and useful. Polish candidates:

- support `NO_COLOR`
- add `BATON: <goal> (8m)` or similar freshness age display when width allows
- make the hard/soft badge text configurable for terminals where symbols render
  poorly
- add snapshot tests for narrow terminal widths and no-color output

## Non-Goals For Now

- no network services
- no database
- no background daemon
- no LLM calls from the CLI
- no broad plugin framework before the core baton quality loop is stronger
- no automatic deletion of user-modified files without explicit confirmation

## Review Order

1. Implement `baton validate`.
2. Wire validation into the `/baton` template.
3. Add `check --json`.
4. Consider `baton status` once freshness and validation helpers exist.

