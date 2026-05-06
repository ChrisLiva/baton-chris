import type { HostAdapter } from "./run.ts";

export const geminiAdapter: HostAdapter = {
  binaryName: "gemini",
  installHint: "Install Gemini CLI from https://github.com/google-gemini/gemini-cli (npm: @google/gemini-cli).",
  buildInvocation(prompt: string): { argv: string[] } {
    return {
      argv: ["--prompt", prompt, "--model", "pro", "--approval-mode", "plan"],
    };
  },
};
