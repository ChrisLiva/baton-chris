import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { renderBatonBadge } from "../src/statusline/widgets.ts";
import { renderStatusline } from "../src/statusline/render.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { batonStateDir } from "../src/config.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

describe("renderBatonBadge", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "baton-statusline-"));
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

  test("returns idle badge for invalid level", () => {
    const sessionId = `test-invalid-level-${process.pid}-${Date.now()}`;
    const dir = batonStateDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({ level: "invalid", maxTokens: 200_000 }));

    const badge = renderBatonBadge(undefined, sessionId, 200_000);

    expect(badge).toContain("→");
    expect(badge).not.toContain("⚠ soft");
    expect(badge).not.toContain("⚠ HARD");
  });
});

describe("renderStatusline width adaptation", () => {
  let originalColumns: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
  });

  const dummyPayload = JSON.stringify({
    model: { display_name: "Sonnet 4.5" },
    worktree: { branch: "main", is_dirty: true },
    context_window: { context_window_size: 200000, used_percentage: 41 },
    rate_limits: { five_hour: { used_percentage: 71 } },
    cost: { total_duration_ms: 720000, total_cost_usd: 1.24 },
  });

  function setColumns(cols: number | undefined) {
    Object.defineProperty(process.stdout, "columns", {
      value: cols,
      writable: true,
      configurable: true,
    });
  }

  test("columns = 200 -> all widgets present", async () => {
    setColumns(200);
    const line = await renderStatusline(dummyPayload);
    expect(line).toContain("Sonnet 4.5");
    expect(line).toContain("main*");
    expect(line).toContain("71%");
    expect(line).toContain("12m");
    expect(line).toContain("$1.24");
  });

  test("columns = 60 -> cost and duration dropped; rateLimit, baton badge, branch, bar, model remain", async () => {
    setColumns(60);
    const line = await renderStatusline(dummyPayload);
    expect(line).toContain("Sonnet 4.5");
    expect(line).toContain("main*");
    expect(line).not.toContain("$1.24");
    expect(line).not.toContain("12m");
  });

  test("columns = 40 -> drop loop trims low-priority widgets but keeps more than the first segment", async () => {
    setColumns(40);
    const line = await renderStatusline(dummyPayload);

    expect(line).toContain("Sonnet 4.5");
    expect(line).toContain("main*");
    expect(line).not.toContain("71%");
    expect(line).not.toContain("12m");
    expect(line).not.toContain("$1.24");
  });

  test("columns < 40 -> everything dropped except the first segment", async () => {
    setColumns(35);
    const line = await renderStatusline(dummyPayload);
    expect(line).toContain("Sonnet 4.5");
    expect(line).not.toContain("main*");
    expect(line).not.toContain("$1.24");
  });

  test("columns = undefined -> all widgets present (no truncation)", async () => {
    setColumns(undefined);
    const line = await renderStatusline(dummyPayload);
    expect(line).toContain("Sonnet 4.5");
    expect(line).toContain("main*");
    expect(line).toContain("71%");
    expect(line).toContain("12m");
    expect(line).toContain("$1.24");
  });

  test("widget absent gracefully skips and drops remaining if needed", async () => {
    setColumns(44);
    const noCostPayload = JSON.stringify({
      model: { display_name: "Sonnet 4.5" },
      context_window: { context_window_size: 200000, used_percentage: 41 },
    });
    const line = await renderStatusline(noCostPayload);
    const stripped = line.replace(ANSI_RE, "");

    expect(line).toContain("Sonnet 4.5");
    expect(line).not.toContain("$");
    expect(stripped.length).toBeLessThanOrEqual(44);
  });

  test("ANSI codes are not counted in visible length", async () => {
    setColumns(60);
    const line = await renderStatusline(dummyPayload);
    const stripped = line.replace(ANSI_RE, "");

    expect(stripped.length).toBeLessThanOrEqual(59);
  });
});
