import type { HostAdapter } from "./run.ts";

export const codexAdapter: HostAdapter = {
  binaryName: "codex",
  installHint: "Install Codex CLI from https://github.com/openai/codex.",
  buildArgv(prompt: string): string[] {
    return [
      "exec",
      "-c",
      "model_reasoning_effort=xhigh",
      "--sandbox",
      "read-only",
      "--ephemeral",
      prompt,
    ];
  },
};
