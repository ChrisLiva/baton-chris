import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { renderBatonBadge } from "../src/statusline/widgets.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { batonStateDir } from "../src/config.ts";

describe("renderBatonBadge", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let stateFilePath: string | null;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "baton-statusline-"));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    stateFilePath = null;
  });

  afterEach(() => {
    if (stateFilePath) {
      rmSync(stateFilePath, { force: true });
    }
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
    stateFilePath = join(dir, `${sessionId}.json`);
    writeFileSync(stateFilePath, JSON.stringify({ level: "invalid", maxTokens: 200_000 }));

    const badge = renderBatonBadge(undefined, sessionId, 200_000);

    expect(badge).toContain("→");
    expect(badge).not.toContain("⚠ soft");
    expect(badge).not.toContain("⚠ HARD");
  });

  describe("baton goal", () => {
    let tmpCwd: string;
    let batonPath: string;

    beforeEach(() => {
      tmpCwd = mkdtempSync(join(tmpdir(), "baton-cwd-"));
      batonPath = join(tmpCwd, ".claude/baton/BATON.md");
      mkdirSync(join(tmpCwd, ".claude/baton"), { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpCwd, { recursive: true, force: true });
    });

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    test("shows extracted goal from fresh baton", () => {
      writeFileSync(batonPath, "# Title\n\n## Current Goal\nRefactor settings-patch for idempotent install\n");
      const badge = renderBatonBadge(tmpCwd, undefined);
      const cleanBadge = badge.replace(/\x1b\[[0-9;]*m/g, "");
      expect(cleanBadge).toContain("BATON: Refactor settings-patch for idempotent…");
    });

    test("truncates long goals with ellipsis", () => {
      writeFileSync(batonPath, "# Title\n\n## Current Goal\nThis is a very long goal that will exceed forty characters easily and definitely needs to be truncated\n");
      const badge = renderBatonBadge(tmpCwd, undefined);
      const cleanBadge = badge.replace(/\x1b\[[0-9;]*m/g, "");
      expect(cleanBadge).toContain("BATON: This is a very long goal that will exce…");
    });

    test("collapses whitespace in goal", () => {
      writeFileSync(batonPath, "# Title\n\n## Current Goal\n   Goal  with\t   extra whitespace   \n");
      const badge = renderBatonBadge(tmpCwd, undefined);
      const cleanBadge = badge.replace(/\x1b\[[0-9;]*m/g, "");
      expect(cleanBadge).toContain("BATON: Goal with extra whitespace");
    });

    test("falls back to default badge for missing goal section", () => {
      writeFileSync(batonPath, "# Title\n\n## Other Section\nNo goal here\n");
      const badge = renderBatonBadge(tmpCwd, undefined);
      expect(badge).toContain("BATON ✓");
    });

    test("falls back to default badge for _none_ goal", () => {
      writeFileSync(batonPath, "# Title\n\n## Current Goal\n_none_\n");
      const badge = renderBatonBadge(tmpCwd, undefined);
      expect(badge).toContain("BATON ✓");
    });

    test("falls back to default badge for _unknown_ goal", () => {
      writeFileSync(batonPath, "# Title\n\n## Current Goal\n_unknown_\n");
      const badge = renderBatonBadge(tmpCwd, undefined);
      expect(badge).toContain("BATON ✓");
    });

    test("invalidates cache when mtime changes", async () => {
      writeFileSync(batonPath, "## Current Goal\nFirst Goal\n");
      let badge = renderBatonBadge(tmpCwd, undefined);
      expect(badge.replace(/\x1b\[[0-9;]*m/g, "")).toContain("BATON: First Goal");

      await delay(10);
      writeFileSync(batonPath, "## Current Goal\nSecond Goal\n");
      badge = renderBatonBadge(tmpCwd, undefined);
      expect(badge.replace(/\x1b\[[0-9;]*m/g, "")).toContain("BATON: Second Goal");
    });

    test("prioritizes fresh baton over hard nudge level", () => {
      writeFileSync(batonPath, "## Current Goal\nFresh Goal\n");

      const sessionId = `test-hard-nudge-${process.pid}-${Date.now()}`;
      const dir = batonStateDir();
      mkdirSync(dir, { recursive: true });
      stateFilePath = join(dir, `${sessionId}.json`);
      writeFileSync(stateFilePath, JSON.stringify({ level: "hard", maxTokens: 200_000 }));

      const badge = renderBatonBadge(tmpCwd, sessionId);
      expect(badge.replace(/\x1b\[[0-9;]*m/g, "")).toContain("BATON: Fresh Goal");
    });
  });
});
