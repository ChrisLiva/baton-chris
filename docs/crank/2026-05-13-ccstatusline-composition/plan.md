# Plan: baton/ccstatusline composition mode
**Date:** 2026-05-13 · **Status:** Plan — ready to execute · [spec.md](./spec.md) · [brainstorm.md](./brainstorm.md)

## Goal

Add `baton widget <name>` and `baton ccstatusline-setup` subcommands so ccstatusline users can compose baton's badge and context-bar into their existing layout, while keeping standalone `baton statusline` byte-identical and install non-interactive.

## Architecture

Extract two pieces of state-persisting code out of `src/statusline/render.ts` into shared modules so a new `src/widget/` tree can re-use them. Refactor `renderBatonBadge` to expose an idle-returns-null helper (`renderBatonBadgeStates`) so the widget can collapse cleanly. Tighten the installer's ccstatusline detection regex and reword its skip warning. Add `isCcstatuslineCommand` and `stripAnsi` utilities, and a TTY-aware setup-instructions subcommand. No on-disk schema changes.

## Tech stack

- Bun runtime (test runner, build) — version pinned by the repo.
- TypeScript (tsc --noEmit via `bun run typecheck`).
- Build target Node via `bun build --target=node` (existing `scripts/build.ts`).
- No new dependencies.

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `src/statusline/status-json.ts` | create | Canonical `StatusJSON` type |
| `src/statusline/session-state.ts` | create | Extracted `persistStateSnapshot`, `tokenTotalFromTranscript` with their module-level caches |
| `src/statusline/color.ts` | modify | Export `stripAnsi(s)` |
| `src/statusline/widgets.ts` | modify | Add `renderBatonBadgeStates`; `renderBatonBadge` delegates to it |
| `src/statusline/render.ts` | modify | Import from `session-state.ts` and `status-json.ts`; drop inlined helpers |
| `src/widget/json.ts` | create | `safeParseStatusJSON(raw)` + `StatusJSON` re-export |
| `src/widget/flags.ts` | create | `parseWidgetFlags(argv) → { color, maxWidth }` |
| `src/widget/badge.ts` | create | `renderBadgeWidget(json, flags) → string` |
| `src/widget/context-bar.ts` | create | `renderContextBarWidget(json, flags) → string` |
| `src/widget/dispatch.ts` | create | `runWidget(name, argv, raw): Promise<void>` |
| `src/install/settings-patch.ts` | modify | Export `isCcstatuslineCommand`; reword skip reason; extend `KNOWN_SUBCOMMANDS` |
| `src/cli.ts` | modify | Wire `widget` and `ccstatusline-setup` subcommands; extend `usage()` |
| `README.md` | modify | Restructure `## Statusline` into composed (recommended) + standalone |
| `test/widget.test.ts` | create | Dispatcher + flags + per-widget cases |
| `test/ccstatusline-setup.test.ts` | create | Setup output assertions |
| `test/install.test.ts` | modify | Add ccstatusline-aware skip-warning tests + `isCcstatuslineCommand` unit test |

## Tasks

### Task 1 — Extract `StatusJSON` to a shared module

Pure type move. No behavior change.

**Files:**
- create `src/statusline/status-json.ts`
- modify `src/statusline/render.ts`

- [ ] **impl** — create `src/statusline/status-json.ts`:
  ```ts
  import type { RateLimit } from "./widgets.ts";

  export interface StatusJSON {
    session_id?: string;
    transcript_path?: string;
    cwd?: string;
    model?: { id?: string; display_name?: string };
    workspace?: { current_dir?: string; project_dir?: string };
    cost?: { total_cost_usd?: number; total_duration_ms?: number };
    context_window?: {
      context_window_size?: number;
      used_percentage?: number;
      current_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      } | null;
    };
    worktree?: { branch?: string; is_dirty?: boolean };
    rate_limits?: {
      five_hour?: RateLimit;
      seven_day?: RateLimit;
    } | null;
  }
  ```

- [ ] **impl** — `src/statusline/render.ts`: delete the `interface StatusJSON { ... }` block at `render.ts:19-41`. Add `import type { StatusJSON } from "./status-json.ts";` alongside the existing imports at the top of the file.
- [ ] **verify** — `bun run typecheck` → exit 0; `bun test test/statusline.test.ts test/statusline-max-tokens.test.ts` → "0 fail".
- [ ] **commit** — `refactor: extract StatusJSON to shared module`.

---

### Task 2 — Extract session-state helpers to a shared module

Pure refactor. Module-level caches move with their owning function.

**Files:**
- create `src/statusline/session-state.ts`
- modify `src/statusline/render.ts`

- [ ] **impl** — create `src/statusline/session-state.ts`. Copy `cachedSnapshot` (`render.ts:104`), `lastPersistedSnapshot` (`render.ts:107-111`), `persistStateSnapshot` (`render.ts:120-156`), and `tokenTotalFromTranscript` (`render.ts:158-170`) verbatim. Export both functions. Required imports:
  ```ts
  import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { batonStateDir } from "../config.ts";
  import { snapshotFromTranscript } from "../transcript/tokens.ts";
  ```

- [ ] **impl** — `src/statusline/render.ts`:
  - Add `import { persistStateSnapshot, tokenTotalFromTranscript } from "./session-state.ts";` to the imports block.
  - Delete `cachedSnapshot` (`render.ts:104`), `lastPersistedSnapshot` (`render.ts:107-111`), `persistStateSnapshot` (`render.ts:120-156`), and `tokenTotalFromTranscript` (`render.ts:158-170`).
  - Prune unused imports — after the deletions, `mkdirSync`, `readFileSync`, `writeFileSync` from `node:fs`, `snapshotFromTranscript` from `../transcript/tokens.ts`, and `batonStateDir` from `../config.ts` are no longer referenced; remove them. Confirm with `grep` over `render.ts` for each name before removing.

- [ ] **verify** — `bun run typecheck` → exit 0; `bun test test/statusline.test.ts test/statusline-max-tokens.test.ts test/user-prompt-submit.test.ts` → "0 fail" (the UserPromptSubmit hook reads the state file the extracted helper writes).
- [ ] **commit** — `refactor: extract session-state helpers to shared module`.

---

### Task 3 — Export `stripAnsi` from `color.ts`

**Files:**
- modify `src/statusline/color.ts`

- [ ] **impl** — `src/statusline/color.ts`: directly after `visibleLength` (`color.ts:4-6`), add:
  ```ts
  export function stripAnsi(s: string): string {
    return s.replace(ANSI_RE, "");
  }
  ```
  `ANSI_RE` is already declared at `color.ts:3` in module scope; no new constant needed.

- [ ] **verify** — `bun run typecheck` → exit 0.
- [ ] **commit** — `feat(statusline): export stripAnsi`.

---

### Task 4 — Extract `renderBatonBadgeStates` from `renderBatonBadge`

The wrapper keeps the existing signature so `render.ts:212` and `render.ts:262` call sites are unchanged. Standalone badge output is byte-identical.

**Files:**
- modify `src/statusline/widgets.ts`
- modify `test/statusline.test.ts`

- [ ] **test** — append to `test/statusline.test.ts`:
  ```ts
  test("renderBatonBadgeStates returns null when idle (no cwd, no sessionId)", async () => {
    const { renderBatonBadgeStates } = await import("../src/statusline/widgets.ts");
    expect(renderBatonBadgeStates(undefined, undefined)).toBeNull();
  });
  ```
  Run `bun test test/statusline.test.ts`, see it fail with "renderBatonBadgeStates is not a function".

- [ ] **impl** — `src/statusline/widgets.ts`: replace `renderBatonBadge` at `widgets.ts:86-122` with:
  ```ts
  export function renderBatonBadgeStates(
    cwd: string | undefined,
    sessionId: string | undefined,
    _max?: number,
    maxWidth?: number,
  ): string | null {
    if (cwd) {
      const batonPath = join(cwd, BATON_REL_PATH);
      if (existsSync(batonPath)) {
        try {
          const stat = statSync(batonPath);
          if (Date.now() - stat.mtimeMs < BATON_FRESH_MS) {
            const goal = readBatonGoal(batonPath, stat.mtimeMs);
            return renderFreshBatonBadge(goal, maxWidth);
          }
        } catch {
          // ignore
        }
      }
    }

    if (sessionId) {
      const statePath = join(batonStateDir(), `${sessionId}.json`);
      if (existsSync(statePath)) {
        try {
          const state = JSON.parse(readFileSync(statePath, "utf8")) as { level?: unknown };
          const level = normalizeLevel(state.level);
          if (level === "hard") return color.bold.red("⚠ HARD");
          if (level === "soft") return color.hex("#ff8800")("⚠ soft");
        } catch {
          // ignore
        }
      }
    }

    return null;
  }

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
  The `_max` parameter is unused inside the helper (idle fallback lives in the wrapper); the underscore signals intentional. All existing imports stay; no new imports needed.

- [ ] **verify** — `bun test test/statusline.test.ts` → "0 fail" (all existing badge tests should keep passing); `bun run typecheck` → exit 0.
- [ ] **commit** — `refactor: extract renderBatonBadgeStates from renderBatonBadge`.

---

### Task 5 — ccstatusline-aware install detection

**Files:**
- modify `src/install/settings-patch.ts`
- modify `test/install.test.ts`

- [ ] **test** — append to `test/install.test.ts`:
  ```ts
  test("install skip warning rewrites for ccstatusline ownership", () => {
    const settingsPath = join(TEST_HOME, ".claude", "settings.json");
    mkdirSync(join(TEST_HOME, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: "command", command: "ccstatusline" } }, null, 2),
    );
    const report = install();
    expect(report.skippedStatuslineReason).toContain("baton ccstatusline-setup");
    expect(report.skippedStatuslineReason).toContain("--force");
  });

  test("install skip warning unchanged for non-ccstatusline statusline", () => {
    const settingsPath = join(TEST_HOME, ".claude", "settings.json");
    mkdirSync(join(TEST_HOME, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: "command", command: "starship" } }, null, 2),
    );
    const report = install();
    expect(report.skippedStatuslineReason).not.toContain("baton ccstatusline-setup");
    expect(report.skippedStatuslineReason).toContain("--force");
  });

  test("isCcstatuslineCommand recognizes invocation forms", async () => {
    const { isCcstatuslineCommand } = await import("../src/install/settings-patch.ts");
    expect(isCcstatuslineCommand("ccstatusline")).toBe(true);
    expect(isCcstatuslineCommand("npx ccstatusline@2.2.16")).toBe(true);
    expect(isCcstatuslineCommand("node /usr/lib/ccstatusline/dist/index.js")).toBe(true);
    expect(isCcstatuslineCommand("bun run ccstatusline")).toBe(true);
    expect(isCcstatuslineCommand("CCSTATUSLINE")).toBe(true);
    expect(isCcstatuslineCommand("echo ccstatusline-not-real")).toBe(false);
    expect(isCcstatuslineCommand("my-ccstatusliner")).toBe(false);
    expect(isCcstatuslineCommand(undefined)).toBe(false);
    expect(isCcstatuslineCommand("")).toBe(false);
  });
  ```
  Run `bun test test/install.test.ts`, confirm three failures (missing helper / un-rewritten message).

- [ ] **impl** — `src/install/settings-patch.ts`:
  1. Extend `KNOWN_SUBCOMMANDS` (`settings-patch.ts:27-36`) by appending two entries:
     ```ts
     "widget",
     "ccstatusline-setup",
     ```
  2. Directly after `KNOWN_SUBCOMMANDS` and before `isBatonCommand` (~line 38), add:
     ```ts
     export function isCcstatuslineCommand(cmd: string | undefined): boolean {
       if (!cmd) return false;
       return /(^|[\\\/\s])ccstatusline([@\s\\\/]|$)/i.test(cmd);
     }
     ```
  3. In `patchStatusline` (`settings-patch.ts:141-165`), inside the `if (existing && !isBatonCommand(existing))` branch, place the new branch **between the closing `}` of the `if (force) { ... return ...; }` block and the existing fallback `return { wrote: false, skipped: ... }`** — so the `--force` replace path still wins for ccstatusline-owned statuslines:
     ```ts
     if (isCcstatuslineCommand(existing)) {
       return {
         wrote: false,
         skipped:
           `existing statusLine.command is "ccstatusline" — leaving it in place. ` +
           `Run \`baton ccstatusline-setup\` for steps to add baton's widgets to ccstatusline, ` +
           `or re-run \`baton install --force\` to replace it with baton's statusline.`,
         replaced: null,
       };
     }
     ```
     The original generic-skip return remains as the fallback for any other non-baton command.

- [ ] **verify** — `bun test test/install.test.ts` → "0 fail"; `bun run typecheck` → exit 0.
- [ ] **commit** — `feat(install): detect ccstatusline and point at composition setup`.

---

### Task 6 — Widget dispatcher, flags parser, and JSON helper

Skeleton with minimal `badge.ts`/`context-bar.ts` returning empty string. Subsequent tasks fill them in. The dispatcher unconditionally calls `persistStateSnapshot` when `session_id` is present (before invoking the renderer), per spec line 67.

**Files:**
- create `src/widget/json.ts`
- create `src/widget/flags.ts`
- create `src/widget/badge.ts` (stub returning `""`)
- create `src/widget/context-bar.ts` (stub returning `""`)
- create `src/widget/dispatch.ts`
- create `test/widget.test.ts`

- [ ] **test** — create `test/widget.test.ts`:
  ```ts
  import { expect, test, describe, beforeEach, afterEach } from "bun:test";
  import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { parseWidgetFlags } from "../src/widget/flags.ts";
  import { safeParseStatusJSON } from "../src/widget/json.ts";
  import { runWidget } from "../src/widget/dispatch.ts";
  import { batonStateDir } from "../src/config.ts";

  function captureStdio<T>(fn: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    let out = "";
    let err = "";
    (process.stdout as { write: (s: string) => boolean }).write = (s: string) => { out += s; return true; };
    (process.stderr as { write: (s: string) => boolean }).write = (s: string) => { err += s; return true; };
    return fn()
      .then((result) => ({ result, out, err }))
      .finally(() => {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
      });
  }

  describe("parseWidgetFlags", () => {
    test("defaults", () => {
      expect(parseWidgetFlags([])).toEqual({ color: false, maxWidth: undefined });
    });
    test("--color sets color", () => {
      expect(parseWidgetFlags(["--color"]).color).toBe(true);
    });
    test("--max-width N (valid)", () => {
      expect(parseWidgetFlags(["--max-width", "20"]).maxWidth).toBe(20);
    });
    test("--max-width non-integer → undefined", () => {
      expect(parseWidgetFlags(["--max-width", "abc"]).maxWidth).toBeUndefined();
    });
    test("--max-width ≤ 0 → undefined", () => {
      expect(parseWidgetFlags(["--max-width", "0"]).maxWidth).toBeUndefined();
      expect(parseWidgetFlags(["--max-width", "-3"]).maxWidth).toBeUndefined();
    });
  });

  describe("safeParseStatusJSON", () => {
    test("valid JSON returns object", () => {
      expect(safeParseStatusJSON('{"cwd":"/x"}')).toEqual({ cwd: "/x" });
    });
    test("malformed JSON returns empty object", () => {
      expect(safeParseStatusJSON("not json")).toEqual({});
    });
    test("empty input returns empty object", () => {
      expect(safeParseStatusJSON("")).toEqual({});
    });
  });

  describe("runWidget", () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalUserProfile: string | undefined;

    beforeEach(() => {
      tmpHome = mkdtempSync(join(tmpdir(), "baton-widget-"));
      originalHome = process.env.HOME;
      originalUserProfile = process.env.USERPROFILE;
      process.env.HOME = tmpHome;
      process.env.USERPROFILE = tmpHome;
    });
    afterEach(() => {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      rmSync(tmpHome, { recursive: true, force: true });
    });

    test("unknown widget name → stdout '\\n', stderr diagnostic", async () => {
      const { out, err } = await captureStdio(() => runWidget("bogus", [], "{}"));
      expect(out).toBe("\n");
      expect(err).toContain("unknown widget");
    });

    test("malformed JSON does not crash; stdout '\\n'", async () => {
      const { out } = await captureStdio(() => runWidget("badge", [], "not json"));
      expect(out).toBe("\n");
    });

    test("writes state file when session_id + context_window_size present", async () => {
      const sessionId = `t-${process.pid}-${Date.now()}`;
      const raw = JSON.stringify({
        session_id: sessionId,
        context_window: { context_window_size: 200000 },
      });
      await captureStdio(() => runWidget("badge", [], raw));
      const statePath = join(batonStateDir(), `${sessionId}.json`);
      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      expect(state.maxTokens).toBe(200000);
    });
  });
  ```
  Run `bun test test/widget.test.ts`, confirm failures (modules missing).

- [ ] **impl** — `src/widget/flags.ts`:
  ```ts
  export interface WidgetFlags {
    color: boolean;
    maxWidth: number | undefined;
  }

  export function parseWidgetFlags(argv: string[]): WidgetFlags {
    let color = false;
    let maxWidth: number | undefined;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--color") {
        color = true;
      } else if (arg === "--max-width") {
        const raw = argv[i + 1];
        i++;
        const n = Number.parseInt(raw ?? "", 10);
        if (Number.isInteger(n) && n > 0 && String(n) === raw) {
          maxWidth = n;
        } else {
          process.stderr.write(`baton widget: invalid --max-width "${raw ?? ""}" — ignored\n`);
        }
      } else {
        process.stderr.write(`baton widget: unknown flag "${arg}" — ignored\n`);
      }
    }
    return { color, maxWidth };
  }
  ```

- [ ] **impl** — `src/widget/json.ts`:
  ```ts
  import type { StatusJSON } from "../statusline/status-json.ts";

  export type { StatusJSON };

  export function safeParseStatusJSON(raw: string): StatusJSON {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as StatusJSON;
    } catch {
      return {};
    }
  }
  ```

- [ ] **impl** — `src/widget/badge.ts` (stub; full impl in Task 7):
  ```ts
  import type { StatusJSON } from "../statusline/status-json.ts";
  import type { WidgetFlags } from "./flags.ts";

  export function renderBadgeWidget(_json: StatusJSON, _flags: WidgetFlags): string {
    return "";
  }
  ```

- [ ] **impl** — `src/widget/context-bar.ts` (stub; full impl in Task 8):
  ```ts
  import type { StatusJSON } from "../statusline/status-json.ts";
  import type { WidgetFlags } from "./flags.ts";

  export function renderContextBarWidget(_json: StatusJSON, _flags: WidgetFlags): string {
    return "";
  }
  ```

- [ ] **impl** — `src/widget/dispatch.ts`:
  ```ts
  import { safeParseStatusJSON } from "./json.ts";
  import { parseWidgetFlags } from "./flags.ts";
  import { renderBadgeWidget } from "./badge.ts";
  import { renderContextBarWidget } from "./context-bar.ts";
  import { persistStateSnapshot } from "../statusline/session-state.ts";

  export async function runWidget(name: string, argv: string[], raw: string): Promise<void> {
    try {
      const json = safeParseStatusJSON(raw);
      const flags = parseWidgetFlags(argv);

      if (json.session_id) {
        const rawPct = json.rate_limits?.five_hour?.used_percentage;
        const rateLimit5hPct =
          typeof rawPct === "number" && Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100
            ? rawPct
            : undefined;
        persistStateSnapshot(json.session_id, {
          maxTokens: json.context_window?.context_window_size,
          rateLimit5hPct,
        });
      }

      let text: string;
      if (name === "badge") {
        text = renderBadgeWidget(json, flags);
      } else if (name === "context-bar") {
        text = renderContextBarWidget(json, flags);
      } else {
        process.stderr.write(`baton widget: unknown widget "${name}"\n`);
        text = "";
      }
      process.stdout.write(text + "\n");
    } catch (err) {
      process.stderr.write(`baton widget ${name}: ${err instanceof Error ? err.message : String(err)}\n`);
      process.stdout.write("\n");
    }
  }
  ```

- [ ] **verify** — `bun test test/widget.test.ts` → "0 fail"; `bun run typecheck` → exit 0.
- [ ] **commit** — `feat(widget): dispatcher, flags parser, and JSON helper`.

---

### Task 7 — Badge widget renderer

**Files:**
- modify `src/widget/badge.ts`
- modify `test/widget.test.ts`

- [ ] **test** — append the badge `describe` block to `test/widget.test.ts`. Place it under a new `describe("renderBadgeWidget", () => { ... })` with its own `beforeEach`/`afterEach` setting up `tmpHome` and `tmpCwd` (mirroring `test/statusline.test.ts:51-63`):
  ```ts
  describe("renderBadgeWidget", () => {
    let tmpHome: string;
    let tmpCwd: string;
    let batonPath: string;
    let originalHome: string | undefined;
    let originalUserProfile: string | undefined;

    beforeEach(() => {
      tmpHome = mkdtempSync(join(tmpdir(), "baton-widget-badge-home-"));
      tmpCwd = mkdtempSync(join(tmpdir(), "baton-widget-badge-cwd-"));
      batonPath = join(tmpCwd, ".claude/baton/BATON.md");
      mkdirSync(join(tmpCwd, ".claude/baton"), { recursive: true });
      originalHome = process.env.HOME;
      originalUserProfile = process.env.USERPROFILE;
      process.env.HOME = tmpHome;
      process.env.USERPROFILE = tmpHome;
    });
    afterEach(() => {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(tmpCwd, { recursive: true, force: true });
    });

    test("fresh baton emits goal", async () => {
      writeFileSync(batonPath, "# T\n\n## Current Goal\nDo the thing\n");
      const { renderBadgeWidget } = await import("../src/widget/badge.ts");
      const out = renderBadgeWidget({ cwd: tmpCwd }, { color: true, maxWidth: 40 });
      expect(out).toMatch(/BATON.*Do the thing/);
    });

    test("idle emits empty string", async () => {
      const { renderBadgeWidget } = await import("../src/widget/badge.ts");
      expect(renderBadgeWidget({ cwd: tmpCwd }, { color: false, maxWidth: undefined })).toBe("");
    });

    test("hard nudge emits ⚠ HARD", async () => {
      const sessionId = `t-${process.pid}-${Date.now()}`;
      mkdirSync(batonStateDir(), { recursive: true });
      writeFileSync(join(batonStateDir(), `${sessionId}.json`), JSON.stringify({ level: "hard" }));
      const { renderBadgeWidget } = await import("../src/widget/badge.ts");
      const out = renderBadgeWidget({ session_id: sessionId }, { color: false, maxWidth: undefined });
      expect(out).toContain("⚠ HARD");
    });

    test("soft nudge emits ⚠ soft", async () => {
      const sessionId = `t-${process.pid}-${Date.now()}-2`;
      mkdirSync(batonStateDir(), { recursive: true });
      writeFileSync(join(batonStateDir(), `${sessionId}.json`), JSON.stringify({ level: "soft" }));
      const { renderBadgeWidget } = await import("../src/widget/badge.ts");
      const out = renderBadgeWidget({ session_id: sessionId }, { color: false, maxWidth: undefined });
      expect(out).toContain("⚠ soft");
    });

    test("--color absent strips ANSI", async () => {
      writeFileSync(batonPath, "# T\n\n## Current Goal\nFoo\n");
      const { renderBadgeWidget } = await import("../src/widget/badge.ts");
      const out = renderBadgeWidget({ cwd: tmpCwd }, { color: false, maxWidth: 40 });
      expect(out).not.toMatch(/\x1b\[/);
    });

    test("--max-width truncates", async () => {
      writeFileSync(batonPath, "# T\n\n## Current Goal\nA very long goal that should be cut\n");
      const { stripAnsi } = await import("../src/statusline/color.ts");
      const { renderBadgeWidget } = await import("../src/widget/badge.ts");
      const out = renderBadgeWidget({ cwd: tmpCwd }, { color: true, maxWidth: 12 });
      expect(stripAnsi(out).length).toBeLessThanOrEqual(12);
    });
  });
  ```
  Make sure `mkdirSync` and `writeFileSync` are imported at the top of `test/widget.test.ts` (alongside the existing `mkdtempSync, rmSync, existsSync, readFileSync` imports). Run `bun test test/widget.test.ts`, see the badge cases fail.

- [ ] **impl** — replace `src/widget/badge.ts`:
  ```ts
  import type { StatusJSON } from "../statusline/status-json.ts";
  import type { WidgetFlags } from "./flags.ts";
  import { renderBatonBadgeStates } from "../statusline/widgets.ts";
  import { stripAnsi } from "../statusline/color.ts";

  const DEFAULT_MAX = 200_000;

  export function renderBadgeWidget(json: StatusJSON, flags: WidgetFlags): string {
    const max = json.context_window?.context_window_size ?? DEFAULT_MAX;
    const rendered = renderBatonBadgeStates(json.cwd, json.session_id, max, flags.maxWidth);
    if (rendered === null) return "";
    return flags.color ? rendered : stripAnsi(rendered);
  }
  ```

- [ ] **verify** — `bun test test/widget.test.ts` → "0 fail"; `bun run typecheck` → exit 0.
- [ ] **commit** — `feat(widget): badge renderer with --color and --max-width`.

---

### Task 8 — Context-bar widget renderer

**Files:**
- modify `src/widget/context-bar.ts`
- modify `test/widget.test.ts`

- [ ] **test** — append to `test/widget.test.ts` under a new `describe("renderContextBarWidget", ...)`:
  ```ts
  describe("renderContextBarWidget", () => {
    test("renders bar at 30%", async () => {
      const { renderContextBarWidget } = await import("../src/widget/context-bar.ts");
      const out = renderContextBarWidget(
        { context_window: { used_percentage: 30, context_window_size: 200000 } },
        { color: false, maxWidth: undefined },
      );
      expect(out).toContain("█");
      expect(out).toContain("/");
    });

    test("red zone at 70% emits ⚠ BATON NOW", async () => {
      const { renderContextBarWidget } = await import("../src/widget/context-bar.ts");
      const out = renderContextBarWidget(
        { context_window: { used_percentage: 70, context_window_size: 200000 } },
        { color: false, maxWidth: undefined },
      );
      expect(out).toContain("⚠ BATON NOW");
    });

    test("no tokens (no used_percentage, no transcript) → empty", async () => {
      const { renderContextBarWidget } = await import("../src/widget/context-bar.ts");
      expect(
        renderContextBarWidget({}, { color: false, maxWidth: undefined }),
      ).toBe("");
    });
  });
  ```
  Run, confirm the bar/red-zone cases fail.

- [ ] **impl** — replace `src/widget/context-bar.ts`:
  ```ts
  import type { StatusJSON } from "../statusline/status-json.ts";
  import type { WidgetFlags } from "./flags.ts";
  import { renderBar } from "../statusline/bar.ts";
  import { tokenTotalFromTranscript } from "../statusline/session-state.ts";
  import { stripAnsi } from "../statusline/color.ts";

  const DEFAULT_MAX = 200_000;
  const DEFAULT_BAR_WIDTH = 12;
  const MIN_BAR_WIDTH = 3;

  export function renderContextBarWidget(json: StatusJSON, flags: WidgetFlags): string {
    const payloadMax = json.context_window?.context_window_size;
    const max = payloadMax ?? DEFAULT_MAX;
    const usedPct = json.context_window?.used_percentage;

    let tokens: number | null = null;
    if (usedPct != null && payloadMax) {
      tokens = Math.round((usedPct / 100) * payloadMax);
    } else if (json.transcript_path) {
      tokens = tokenTotalFromTranscript(json.transcript_path);
    }
    if (tokens === null) return "";

    let width = DEFAULT_BAR_WIDTH;
    if (flags.maxWidth !== undefined) {
      if (flags.maxWidth >= MIN_BAR_WIDTH) {
        width = flags.maxWidth;
      } else {
        process.stderr.write(
          `baton widget context-bar: --max-width ${flags.maxWidth} < ${MIN_BAR_WIDTH}, using default ${DEFAULT_BAR_WIDTH}\n`,
        );
      }
    }

    const rendered = renderBar(tokens, max, width);
    return flags.color ? rendered : stripAnsi(rendered);
  }
  ```

- [ ] **verify** — `bun test test/widget.test.ts` → "0 fail"; `bun run typecheck` → exit 0.
- [ ] **commit** — `feat(widget): context-bar renderer`.

---

### Task 9 — Wire `widget` and `ccstatusline-setup` into the CLI

**Files:**
- modify `src/cli.ts`
- create `test/ccstatusline-setup.test.ts`

- [ ] **test** — create `test/ccstatusline-setup.test.ts`:
  ```ts
  import { expect, test } from "bun:test";
  import { spawnSync } from "node:child_process";
  import { join } from "node:path";

  test("ccstatusline-setup prints expected blocks", () => {
    const cliPath = join(import.meta.dir, "..", "src", "cli.ts");
    const result = spawnSync("bun", ["run", cliPath, "ccstatusline-setup"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const out = result.stdout;
    expect(out).toContain("widget badge");
    expect(out).toContain("widget context-bar");
    expect(out).toContain("timeout: 3000");
    expect(out).toContain("preserveColors");
    expect(out).toContain("Run `ccstatusline` in a terminal");
  });

  test("widget badge end-to-end: empty payload → '\\n', exit 0", () => {
    const cliPath = join(import.meta.dir, "..", "src", "cli.ts");
    const result = spawnSync("bun", ["run", cliPath, "widget", "badge"], {
      input: "{}",
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("\n");
  });

  test("widget unknown name → '\\n' stdout, stderr diagnostic, exit 0", () => {
    const cliPath = join(import.meta.dir, "..", "src", "cli.ts");
    const result = spawnSync("bun", ["run", cliPath, "widget", "bogus"], {
      input: "{}",
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("\n");
    expect(result.stderr).toContain("unknown widget");
  });
  ```
  Run, confirm failures (the `widget` and `ccstatusline-setup` cases hit `usage()` and exit 2 today).

- [ ] **impl** — `src/cli.ts`:
  1. Add three import edits at the top of the file:
     - **Amend the existing line** `import { VERSION } from "./config.ts";` at `cli.ts:7` to `import { VERSION, buildCommand } from "./config.ts";` (do not duplicate the import).
     - **Add a new import line** `import { runWidget } from "./widget/dispatch.ts";` alongside the other relative imports.
     - **Add a new import line** `import { color } from "./statusline/color.ts";` (no existing reference to `color` in this file — it is a fresh import).

  2. Inside the `switch (cmd)` at `cli.ts:76`, after the `case "statusline":` block (~line 82), add:
     ```ts
     case "widget": {
       const widgetName = args[1] ?? "";
       const widgetArgs = args.slice(2);
       const raw = await readStdin();
       await runWidget(widgetName, widgetArgs, raw);
       return 0;
     }
     case "ccstatusline-setup": {
       process.stdout.write(buildCcstatuslineSetup());
       return 0;
     }
     ```

  3. Add `buildCcstatuslineSetup()` at module level (place it just below `usage()` at `cli.ts:66`):
     ```ts
     function buildCcstatuslineSetup(): string {
       const isTTY = !!process.stdout.isTTY;
       const dim = (s: string): string => (isTTY ? color.dim(s) : s);
       const bold = (s: string): string => (isTTY ? color.bold(s) : s);
       const badgeCmd = buildCommand("widget badge --color --max-width 40");
       const barCmd = buildCommand("widget context-bar --color --max-width 12");
       return [
         bold("baton + ccstatusline composition"),
         "",
         "Two baton widgets to add to ccstatusline:",
         "",
         bold("1. Baton badge") + " — shows BATON.md goal when fresh, or ⚠ soft / ⚠ HARD when nudges have fired.",
         "",
         `   Command path:  ${badgeCmd}`,
         "   maxWidth:      <leave blank — badge is already sized via --max-width>",
         "   timeout:       3000",
         "   preserveColors: ON",
         "",
         dim("   (--max-width 40 covers `BATON: ` (7 chars) + ~32 chars of goal title before"),
         dim("   ellipsis; this matches the standalone statusline's default goal budget.)"),
         "",
         bold("2. Baton context-bar") + " — colored against baton's soft/hard thresholds (the same ones that drive nudges).",
         "",
         `   Command path:  ${barCmd}`,
         "   maxWidth:      <leave blank — bar is already sized via --max-width>",
         "   timeout:       3000",
         "   preserveColors: ON",
         "",
         bold("How to add each one in ccstatusline:"),
         "",
         "  1. Run `ccstatusline` in a terminal.",
         "  2. Use the TUI to add a Custom Command widget on the line/position you want.",
         "  3. Paste the command path above into the command field.",
         "  4. Press `t` to set timeout to 3000.",
         "  5. Press `p` to turn ON preserveColors (so baton's threshold colors render).",
         "  6. Save and exit.",
         "",
         "Both widgets read Claude Code's statusline JSON on stdin and emit one line on",
         "stdout. They always exit 0; on error, stderr gets a diagnostic and stdout is",
         "empty (the widget collapses). Drop `--color` from the command path if you'd",
         "rather have ccstatusline's per-widget color settings paint the output.",
         "",
         "If you have not yet pointed ccstatusline at Claude Code:",
         "  Set `statusLine.command` in ~/.claude/settings.json to `ccstatusline`",
         "  (or your preferred invocation form), then re-run `baton install`.",
         "",
       ].join("\n");
     }
     ```
     Verify `color.bold` is callable as a function — `src/statusline/color.ts:21-27` defines `bold` as `Painter & { ... }`, where `Painter = (text: string) => string`, so `color.bold("x")` works.

  4. Extend `usage()` (`cli.ts:30-66`):
     - Under "Subcommands:" list (around `cli.ts:55` after the `sidecar gemini` block), insert:
       ```
       "  ccstatusline-setup          print copy-paste instructions for wiring",
       "                              baton widgets into ccstatusline",
       "",
       ```
     - Under "Internal" list (around `cli.ts:62` before `hook user-prompt-submit`), insert:
       ```
       "  widget <name>               render a baton widget for ccstatusline composition",
       "                              (name: badge|context-bar; flags: --color, --max-width N)",
       ```

- [ ] **verify** — `bun test test/ccstatusline-setup.test.ts` → "0 fail"; `bun run typecheck` → exit 0; manual: `bun run src/cli.ts ccstatusline-setup` prints the block; `echo '{}' | bun run src/cli.ts widget badge` prints `\n` and exits 0.
- [ ] **commit** — `feat(cli): add baton widget and baton ccstatusline-setup subcommands`.

---

### Task 10 — README: lead with composition, keep standalone

No test seam — docs change. Verify with `bun run build` and a build check.

**Files:**
- modify `README.md`

- [ ] **impl** — replace `README.md:63-73` (the `## Statusline` section through the existing screenshot block) with the block below. The outer fence uses `~~~md` so nested triple-backtick code fences inside render correctly:

  ~~~md
  ## Statusline

  baton ships in two flavors: drop into your existing [ccstatusline](https://github.com/jasonkrol/ccstatusline) layout (recommended), or run as a zero-config standalone.

  ### Composed with ccstatusline (recommended)

  If you already use ccstatusline, baton can plug its BATON.md badge and threshold-colored context bar into your layout as custom-command widgets — ccstatusline still owns separators, Powerline caps, and theming.

  Run:

  ```bash
  baton ccstatusline-setup
  ```

  for copy-paste-ready widget commands and the exact TUI steps. baton's installer detects ccstatusline ownership of the statusline and leaves it in place; only the warning text changes to point at this subcommand.

  ### Standalone

  The standalone statusline shows model, branch, context usage, baton state, rate limit, duration, and cost in one compact row:

  ```text
  Sonnet 4.5 │ main* │ [======----] 82k/200k │ BATON: Refactor settings-patch │ 5h 71% │ 12m │ $1.24
  ```

  When context gets high, baton nudges Claude to snapshot. At the hard threshold, it injects the baton protocol directly so Claude writes the baton before auto-compaction can discard useful state.

  When the 5-hour rate-limit is above 90%, baton escalates the hard nudge earlier (at ~45% of the context window instead of 60%), so you snapshot before one more long turn hits the rate wall and prevents Claude from authoring a baton on demand.
  ~~~

  Leave `## Configuration` and everything below it unchanged.

- [ ] **verify** — `bun run build` → exit 0 and `dist/cli.js` starts with `#!/usr/bin/env node`; `bun test` → exit 0, "0 fail" across the full suite.
- [ ] **commit** — `docs(readme): lead with ccstatusline composition, keep standalone as fallback`.

---

### Task 11 — Write retro

**Files:**
- create `docs/crank/2026-05-13-ccstatusline-composition/retro.md`

- [ ] **impl** — write `docs/crank/2026-05-13-ccstatusline-composition/retro.md` with the following sections (fill in content from the actual execution session):
  ```md
  # Retro: baton/ccstatusline composition mode
  **Date:** <execution date>

  ## Summary
  <2–4 sentences on what shipped vs. the goal stated in plan.md.>

  ## Deviations from the plan
  <Per task that ended up meaningfully different from the planned steps. If a task ran clean, omit.>

  ## Notes for future work
  <Anything spotted during execution that's worth a follow-up: the deferred `baton check` line for composition, the two `Assumption:` items, perf snapshot results, etc.>

  ## Loose ends
  <Anything left intentionally incomplete or open at the end of execution.>
  ```

- [ ] **verify** — `test -f docs/crank/2026-05-13-ccstatusline-composition/retro.md` → exit 0; file non-empty.
- [ ] **commit** — `docs(crank): retro for ccstatusline composition mode`.

---

## Smoke tests for the user

These cannot be automated and must be exercised manually before the PR is marked ready:

- **Visual end-to-end in a real ccstatusline session.** Install baton, install ccstatusline, run `baton ccstatusline-setup`, follow the printed instructions in the ccstatusline TUI to wire both widgets, restart Claude Code, open a session, write a short BATON.md. Look for: badge appears with the goal, threshold-colored context bar appears alongside ccstatusline's own widgets without layout breakage, Powerline caps (if user has them) render cleanly around baton's widgets.

- **Perf snapshot (informational, not gating).** `time (echo '{}' | bun run src/cli.ts widget badge)` measured 5×; expectation is max wall time < 3000ms on the dev machine. If exceeded on macOS/Linux/Windows, raise the recommended `timeout` in the setup subcommand or steer composition users to the published Node build (`npm install -g ccbaton`). Captured in the PR description, not a CI gate.

## Open items

- **`baton check` reporting for composition.** Spec defers this to a follow-up — not load-bearing for the composition path itself, since `printCheckReport` already shows when the statusline is non-baton. Picked up later if signal accumulates.
- **Assumption — Bun cold-start fits inside 3000ms** on source-mode installs across macOS/Linux/Windows. Invalidated by a measured run exceeding 3s during the perf smoke. If invalidated, raise the recommended `timeout` in the setup subcommand or steer composition users to the published Node build.
- **Assumption — ccstatusline's `CustomCommand` widget contract stays stable** (`stdin = JSON; stdout = text; exit 0 = ok; non-zero → "[Error]"`) through its next minor release. Invalidated by a ccstatusline release changing the JSON-on-stdin contract or the per-widget exec model. If invalidated, revisit `src/widget/dispatch.ts`'s stdin parser.

## Out of scope

- Writing into `~/.config/ccstatusline/settings.json` from baton.
- Adding widget types beyond `badge` and `context-bar`.
- Changing `baton install` interactivity or `--force` semantics.
- Deprecating standalone `baton statusline`.
- A `--apply`-style auto-wire-into-ccstatusline flag.

## Review log

Reviewer: Sonnet, adversarial pass · Date: 2026-05-13

### Adopted

- Task 5 `isCcstatuslineCommand` insertion-point ambiguity → branch placement now pinned "between the closing `}` of the `if (force) { ... return ...; }` block and the existing fallback `return`," so the `--force` replace path still wins for ccstatusline-owned statuslines.
- Task 9 import-edit clarity → step 1 now distinguishes three separate edits (amend the existing `VERSION` import to add `buildCommand`; add a fresh `runWidget` import; add a fresh `color` import that has no prior anchor in `cli.ts`).
- Task 10 nested code-fence rendering → the outer wrapper around the README replacement block now uses `~~~md` so nested triple-backtick fences (` ```bash `, ` ```text `) inside the replacement render correctly in Markdown previewers.

### Considered, not adopted

- "Blocker" — `tokenTotalFromTranscript` returns `0` (not `null`) on read failure, so context-bar would render `0/200k` instead of collapsing when transcript is present but empty/unreadable. Rejected. Spec line 119–120 defines the empty-widget trigger as "no transcript AND no `used_percentage`," which is exactly what the planned `tokens === null` guard captures (neither branch fires → `tokens` stays `null`). Transcript-present-but-unreadable is a different case where the spec explicitly mirrors standalone behavior ("same fall-back chain as `render.ts:197-203`"), and `render.ts` itself renders `0/200k` in that case. Changing the return type would silently diverge from standalone.
- `ANSI_RE` `/g` flag shared-state concern in `stripAnsi`. Rejected. Reviewer self-noted "safe in practice" — `String.prototype.replace` resets `lastIndex` on global regexes. Inlining the literal regex is a YAGNI hedge against a hypothetical future caller; the current single use is safe.
- `captureStdio` test helper handling `Buffer` writes. Rejected as YAGNI — all current writers (dispatcher, flags parser) pass strings; widening the mock for a hypothetical future Buffer caller is speculative.
- `String(n) === raw` strictness in `parseWidgetFlags`. Rejected (no change needed) — reviewer self-resolved that the strict parse is the right behavior (it correctly rejects `"20abc"`, `" 20"`, `"+20"`).
- Several reviewer items flagged as concerns but then self-resolved in the same bullet (Task 5 dynamic-import caching, Task 7 max-width arithmetic, Task 9 `args[1]` convention, `color.bold` callability, `_max` underscore-prefix vs `noUnusedParameters`, trailing newline in setup output). No plan change needed.

### Open items

- None — no reviewer concern required additional user input.
