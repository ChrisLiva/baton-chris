import type { HostAdapter } from "./run.ts";

export const geminiAdapter: HostAdapter = {
  binaryName: "gemini",
  installHint: "Gemini sidecar is not yet wired up.",
  buildArgv(): string[] {
    throw new Error(
      "baton sidecar gemini: not yet supported in this release. Codex is the only host wired in v1.",
    );
  },
};
