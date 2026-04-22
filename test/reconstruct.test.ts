import { expect, test, describe, afterEach, beforeEach } from "bun:test";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { runReconstruct } from "../src/baton/reconstruct.ts";
import { writeTranscriptFixture } from "./fixtures.ts";
import { BATON_REL_PATH } from "../src/config.ts";

describe("reconstruct", () => {
  const tempDir = join(import.meta.dir, "test-reconstruct-temp");
  const originalCwd = process.cwd();

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reconstructs to default path based on cwd", () => {
    const tPath = writeTranscriptFixture(tempDir, "default.jsonl", {
      inputTokens: 100,
      outputTokens: 50,
      extraTurns: 1,
    });

    process.chdir(tempDir);

    let stdoutData = "";
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array, cb?: any) => {
      stdoutData += chunk.toString();
      return true;
    };

    try {
      const exitCode = runReconstruct({ transcriptPath: tPath });

      expect(exitCode).toBe(0);
      const expectedOutPath = join(tempDir, BATON_REL_PATH);
      expect(existsSync(expectedOutPath)).toBe(true);
      expect(stdoutData).toContain("baton reconstruct: wrote");
      expect(stdoutData).toContain("tokens");

      const content = readFileSync(expectedOutPath, "utf8");
      expect(content).toContain("final response referencing src/foo.ts:42");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  test("reconstructs with absolute --out path", () => {
    const tPath = writeTranscriptFixture(tempDir, "absolute.jsonl", {
      inputTokens: 100,
      outputTokens: 50,
      extraTurns: 1,
    });

    const outPath = join(tempDir, "custom", "BATON.md");

    let stdoutData = "";
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array, cb?: any) => {
      stdoutData += chunk.toString();
      return true;
    };

    try {
      const exitCode = runReconstruct({ transcriptPath: tPath, outPath });

      expect(exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      expect(stdoutData).toContain(outPath);
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  test("reconstructs with relative --out path", () => {
    const tPath = writeTranscriptFixture(tempDir, "relative.jsonl", {
      inputTokens: 100,
      outputTokens: 50,
      extraTurns: 1,
    });

    process.chdir(tempDir);

    let stdoutData = "";
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array, cb?: any) => {
      stdoutData += chunk.toString();
      return true;
    };

    try {
      const exitCode = runReconstruct({ transcriptPath: tPath, outPath: "relative-dir/BATON.md" });

      expect(exitCode).toBe(0);
      expect(existsSync(join(tempDir, "relative-dir/BATON.md"))).toBe(true);
      expect(stdoutData).toContain("relative-dir");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  test("reconstruct with absolute --out still loads project .batonignore patterns", () => {
    const transcriptPath = join(tempDir, "redaction.jsonl");
    const outPath = join(tempDir, "outside-output", "BATON.md");
    writeFileSync(join(tempDir, ".batonignore"), "MY_PROJECT_SECRET:::TOKEN_\\w{16}\n");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "assistant",
          isSidechain: false,
          isApiErrorMessage: false,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "contains TOKEN_abcdef1234567890 in transcript" }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          },
        }),
      ].join("\n") + "\n",
    );

    process.chdir(tempDir);

    const exitCode = runReconstruct({ transcriptPath, outPath });

    expect(exitCode).toBe(0);
    const content = readFileSync(outPath, "utf8");
    expect(content).toContain("[redacted MY_PROJECT_SECRET]");
    expect(content).not.toContain("TOKEN_abcdef1234567890");
  });

  test("missing transcript returns 1 and prints stderr", () => {
    let stderrData = "";
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = (chunk: string | Uint8Array, cb?: any) => {
      stderrData += chunk.toString();
      return true;
    };

    try {
      const exitCode = runReconstruct({ transcriptPath: "/tmp/does-not-exist.jsonl" });

      expect(exitCode).toBe(1);
      expect(stderrData).toContain("baton reconstruct: transcript not found");
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });
});
