import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { snapshotFromTranscript } from "../transcript/tokens.ts";
import { writeFallbackBaton } from "./fallback-writer.ts";

export interface ReconstructOpts {
  transcriptPath: string;
  outPath?: string;
}

export function runReconstruct(opts: ReconstructOpts): number {
  const tPath = resolve(opts.transcriptPath);
  if (!existsSync(tPath)) {
    process.stderr.write(`baton reconstruct: transcript not found: ${tPath}\n`);
    return 1;
  }

  const tokens = snapshotFromTranscript(tPath).total;
  const cwd = process.cwd();
  const written = writeFallbackBaton(cwd, tPath, tokens, opts.outPath);

  process.stdout.write(
    `baton reconstruct: wrote ${written} (~${Math.round(tokens / 1000)}k tokens)\n`,
  );
  return 0;
}
