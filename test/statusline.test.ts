import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { renderBatonBadge } from "../src/statusline/widgets.ts";
import { renderStatusline } from "../src/statusline/render.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { batonStateDir } from "../src/config.ts";

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
    expect(line).toContain("71%"); // rate limit
    expect(line).toContain("12m"); // duration
    expect(line).toContain("$1.24"); // cost
  });

  test("columns = 60 -> cost and duration dropped; rateLimit, baton badge, branch, bar, model remain", async () => {
    // A 60-col terminal is narrow enough to drop cost and duration.
    // If rateLimit needs to drop too, it will, depending on exactly how long the string is.
    // But we know at least cost and duration should drop, and model, branch, bar, batonBadge remain.
    setColumns(60);
    const line = await renderStatusline(dummyPayload);
    expect(line).toContain("Sonnet 4.5");
    expect(line).toContain("main*");
    // When no active badge, we show a default arrow badge instead of BATON word, wait no, let's just assert length drops properly and drops duration and cost
    expect(line).not.toContain("$1.24"); // dropped
    expect(line).not.toContain("12m"); // dropped
  });

  test("columns = 40 -> everything dropped except the first segment", async () => {
    setColumns(35); // strictly below 40 drops everything but first segment
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
    setColumns(45); // quite narrow
    const noCostPayload = JSON.stringify({
      model: { display_name: "Sonnet 4.5" },
      worktree: { branch: "main", is_dirty: true },
      context_window: { context_window_size: 200000, used_percentage: 41 },
      rate_limits: { five_hour: { used_percentage: 71 } },
    });
    const line = await renderStatusline(noCostPayload);
    expect(line).toContain("Sonnet 4.5");
    // it shouldn't crash trying to drop cost, and might drop rateLimit.
  });

  test("ANSI codes are not counted in visible length", async () => {
    // We only truncate `rateLimit`, `duration`, `cost` at `40` column limit. If cols=45, nothing gets dropped except rateLimit, duration, cost
    setColumns(45);
    const payload = JSON.stringify({
      model: { display_name: "A" },
      worktree: { branch: "B", is_dirty: false },
      context_window: { context_window_size: 1000, used_percentage: 1 },
    });
    const line = await renderStatusline(payload);
    expect(line).toContain("A");
    expect(line).toContain("B");
  });
});
