import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { snapshotFromTranscript } from "../transcript/tokens.ts";
import { writeFallbackBaton } from "./fallback-writer.ts";

export interface ReconstructOpts {
  transcriptPath: string;
  outPath?: string;   // defaults to <cwd>/.claude/baton/BATON.md
}

export async function runReconstruct(opts: ReconstructOpts): Promise<number> {
  const tPath = resolve(opts.transcriptPath);
  if (!existsSync(tPath)) {
    process.stderr.write(`baton reconstruct: transcript not found: ${tPath}\n`);
    return 1;
  }

  const tokens = snapshotFromTranscript(tPath).total;

  // If --out is provided and absolute: write there.
  // Otherwise: use cwd-based default via writeFallbackBaton(cwd, ...).
  const cwd = opts.outPath
    ? (isAbsolute(opts.outPath) ? dirname(dirname(dirname(opts.outPath))) : process.cwd())
    : process.cwd();

  const written = writeFallbackBaton(cwd, tPath, tokens, opts.outPath);

  process.stdout.write(
    `baton reconstruct: wrote ${written} (~${Math.round(tokens / 1000)}k tokens)\n`,
  );
  return 0;
}
