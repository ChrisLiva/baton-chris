import { expect, test, describe, afterEach, beforeEach } from "bun:test";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
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
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    process.chdir(originalCwd);
  });

  test("reconstructs to default path based on cwd", async () => {
    const tPath = writeTranscriptFixture(tempDir, "default.jsonl", {
      inputTokens: 100,
      outputTokens: 50,
      extraTurns: 1
    });

    process.chdir(tempDir);

    let stdoutData = "";
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array, cb?: any) => {
      stdoutData += chunk.toString();
      return true;
    };

    const exitCode = await runReconstruct({ transcriptPath: tPath });

    process.stdout.write = originalStdoutWrite;

    expect(exitCode).toBe(0);
    const expectedOutPath = join(tempDir, BATON_REL_PATH);
    expect(existsSync(expectedOutPath)).toBe(true);
    expect(stdoutData).toContain("baton reconstruct: wrote");
    expect(stdoutData).toContain("tokens");

    const content = readFileSync(expectedOutPath, "utf8");
    expect(content).toContain("final response referencing src/foo.ts:42");
  });

  test("reconstructs with absolute --out path", async () => {
    const tPath = writeTranscriptFixture(tempDir, "absolute.jsonl", {
      inputTokens: 100,
      outputTokens: 50,
      extraTurns: 1
    });

    const outPath = join(tempDir, "custom", "BATON.md");

    let stdoutData = "";
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array, cb?: any) => {
      stdoutData += chunk.toString();
      return true;
    };

    const exitCode = await runReconstruct({ transcriptPath: tPath, outPath });

    process.stdout.write = originalStdoutWrite;

    expect(exitCode).toBe(0);
    expect(existsSync(outPath)).toBe(true);
  });

  test("reconstructs with relative --out path", async () => {
    const tPath = writeTranscriptFixture(tempDir, "relative.jsonl", {
      inputTokens: 100,
      outputTokens: 50,
      extraTurns: 1
    });

    process.chdir(tempDir);

    let stdoutData = "";
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array, cb?: any) => {
      stdoutData += chunk.toString();
      return true;
    };

    const exitCode = await runReconstruct({ transcriptPath: tPath, outPath: "relative-dir/BATON.md" });

    process.stdout.write = originalStdoutWrite;

    expect(exitCode).toBe(0);
    expect(existsSync(join(tempDir, "relative-dir/BATON.md"))).toBe(true);
  });

  test("missing transcript returns 1 and prints stderr", async () => {
    let stderrData = "";
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = (chunk: string | Uint8Array, cb?: any) => {
      stderrData += chunk.toString();
      return true;
    };

    const exitCode = await runReconstruct({ transcriptPath: "/tmp/does-not-exist.jsonl" });

    process.stderr.write = originalStderrWrite;

    expect(exitCode).toBe(1);
    expect(stderrData).toContain("baton reconstruct: transcript not found");
  });
});
