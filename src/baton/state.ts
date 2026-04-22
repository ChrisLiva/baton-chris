export type NudgeLevel = "none" | "soft" | "hard";

export interface BatonState {
  level: NudgeLevel;
  maxTokens?: number;
  timeNudgeSent?: boolean;
}

export function normalizeLevel(raw: unknown): NudgeLevel {
  return raw === "soft" || raw === "hard" ? raw : "none";
}

export function normalizeMaxTokens(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}
