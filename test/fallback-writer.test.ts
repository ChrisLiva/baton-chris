import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { extractFilePaths } from "../src/baton/fallback-writer.ts";
import type { TranscriptEntry } from "../src/transcript/read.ts";

function entry(text: string): TranscriptEntry {
  return {
    type: "assistant",
    isSidechain: false,
    isApiErrorMessage: false,
    message: { role: "assistant", content: text },
  };
}

describe("extractFilePaths", () => {
  test("matches real file paths and strips trailing punctuation", () => {
    expect(
      extractFilePaths([
        entry("Changed src/app.ts:12 and ./test/fallback-writer.test.ts, plus C:\\repo\\baton\\src\\cli.ts."),
      ]),
    ).toEqual(["src/app.ts:12", "./test/fallback-writer.test.ts", "C:\\repo\\baton\\src\\cli.ts"]);
  });

  test("rejects URLs, version numbers, abbreviations, and bare filenames", () => {
    expect(
      extractFilePaths([
        entry("Ignore example.com, https://example.com/api.ts, 1.2.3, U.S.A., and package.json."),
      ]),
    ).toEqual([]);
  });

  test("deduplicates case-insensitively", () => {
    expect(extractFilePaths([entry("See src/App.ts and src/app.ts")])).toEqual(["src/app.ts"]);
  });
});

import { writeFallbackBaton } from "../src/baton/fallback-writer.ts";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BATON_REL_PATH } from "../src/config.ts";

describe("writeFallbackBaton redaction integration", () => {
  const tmpDir = join(import.meta.dir, ".tmp-fallback");
  const transcriptPath = join(tmpDir, "transcript.json");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });

    // Create a mock transcript
    const transcript = [
      {
        type: "assistant",
        isSidechain: false,
        message: {
          role: "assistant",
          content: "Here is a token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890-abcdefg"
        }
      }
    ];
    writeFileSync(transcriptPath, transcript.map(t => JSON.stringify(t)).join("\n") + "\n");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("runs redaction and appends ## Redactions section", () => {
    writeFallbackBaton(tmpDir, transcriptPath, 1000);
    const batonPath = join(tmpDir, BATON_REL_PATH);
    const content = readFileSync(batonPath, "utf8");

    expect(content).toContain("[redacted Anthropic API key]");
    expect(content).toContain("## Redactions");
    expect(content).toContain("- 1x Anthropic API key");
    expect(content).not.toContain("sk-ant-api03");
  });

  test("respects outPathOverride when provided", () => {
    const customPath = join(tmpDir, "custom", "fallback.md");
    writeFallbackBaton(tmpDir, transcriptPath, 1000, customPath);

    const content = readFileSync(customPath, "utf8");
    expect(content).toContain("[redacted Anthropic API key]");
    expect(content).toContain("## Redactions");
  });
});
