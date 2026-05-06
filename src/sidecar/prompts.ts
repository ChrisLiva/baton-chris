export type SidecarMode = "review" | "critique" | "alternative";

export const SIDECAR_MODES: readonly SidecarMode[] = ["review", "critique", "alternative"] as const;

export function isSidecarMode(value: unknown): value is SidecarMode {
  return value === "review" || value === "critique" || value === "alternative";
}

const MODE_PREAMBLES: Record<SidecarMode, string> = {
  review:
    "You are a senior engineer reviewing another agent's working state. Below is a baton — a structured snapshot of what that agent is working on, what's done, what's next, and what files matter. Audit it. Identify gaps, hidden assumptions, missing edge cases, and any work declared done that doesn't actually meet the stated Current Goal. Cite specific line numbers and file paths from the baton. Be direct. Keep the response under 1000 words.",
  critique:
    "You are a senior engineer arguing against another agent's approach. Below is a baton — a structured snapshot of what that agent is working on. Steelman the case against this approach: what fails under load, what edge cases are unaddressed, where the agent might be over-fitting to the current task, and what a stronger alternative would be. Cite specific line numbers and file paths from the baton. Be direct. Keep the response under 1000 words.",
  alternative:
    "You are a senior engineer proposing a substantively different approach to the same goal. Below is a baton — a structured snapshot of another agent's working state. Without evaluating their approach, sketch a different plan that achieves the same Current Goal. Highlight tradeoffs versus the existing direction. Cite specific files and line numbers from the baton when grounding your alternative. Keep the response under 1000 words.",
};

export function composePrompt(mode: SidecarMode, batonBody: string): string {
  return `${MODE_PREAMBLES[mode]}\n\n---\n\n${batonBody}`;
}
