import type { HostAdapter } from "./run.ts";

export const codexAdapter: HostAdapter = {
  binaryName: "codex",
  installHint: "Install Codex CLI from https://github.com/openai/codex.",
  buildInvocation(prompt: string): { argv: string[]; stdin: string } {
    return {
      argv: [
        "exec",
        "-c",
        "model_reasoning_effort=xhigh",
        "--sandbox",
        "read-only",
        "--ephemeral",
        "-",
      ],
      stdin: prompt,
    };
  },
};
