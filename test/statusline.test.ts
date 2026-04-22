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
