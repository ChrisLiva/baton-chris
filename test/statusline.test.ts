import { expect, test, describe } from "bun:test";
import { renderBatonBadge } from "../src/statusline/widgets.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { batonStateDir } from "../src/config.ts";

describe("renderBatonBadge", () => {
  test("returns idle badge for invalid level", () => {
    const sessionId = "test-invalid-level";
    const dir = batonStateDir();
    mkdirSync(dir, { recursive: true });
    const statePath = join(dir, `${sessionId}.json`);

    // Write an invalid level
    writeFileSync(statePath, JSON.stringify({ level: "invalid", maxTokens: 200_000 }));

    const badge = renderBatonBadge(undefined, sessionId, 200_000);

    // It should render the idle badge containing the arrow and max size, not soft/hard.
    expect(badge).toContain("→");
    expect(badge).not.toContain("⚠ soft");
    expect(badge).not.toContain("⚠ HARD");

    // Cleanup
    rmSync(statePath);
  });
});
