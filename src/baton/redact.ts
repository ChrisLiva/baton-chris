import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface RedactPattern {
  regex: RegExp;
  label: string;
}

export const DEFAULT_PATTERNS: RedactPattern[] = [
  // Generic "KEY=value" where KEY looks like a secret
  { regex: /\b([A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD))\s*[:=]\s*['"]?([A-Za-z0-9_\-+/=]{16,})['"]?/g, label: "secret assignment" },
  // Anthropic
  { regex: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g, label: "Anthropic API key" },
  // OpenAI
  { regex: /\bsk-[A-Za-z0-9]{20,}\b/g, label: "OpenAI-style API key" },
  // AWS access key
  { regex: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS access key ID" },
  // AWS secret (heuristic; high false positive risk — keep but doc)
  { regex: /\baws_secret_access_key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi, label: "AWS secret access key" },
  // GitHub PAT classic + fine-grained
  { regex: /\bghp_[A-Za-z0-9]{36,}\b/g, label: "GitHub classic token" },
  { regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, label: "GitHub fine-grained token" },
  // JWT (best-effort)
  { regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: "JWT" },
  // Authorization bearer
  { regex: /\b(Authorization|authorization)\s*:\s*Bearer\s+[A-Za-z0-9_\-.]+/g, label: "Bearer header" },
];

function parseIgnoreFile(path: string): RedactPattern[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const patterns: RedactPattern[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line || line.startsWith("#")) continue;

    let label = "user pattern";
    let regexStr = line;

    const pipeIndex = line.indexOf("|");
    if (pipeIndex !== -1) {
      label = line.substring(0, pipeIndex);
      regexStr = line.substring(pipeIndex + 1);
    }

    try {
      patterns.push({
        regex: new RegExp(regexStr, "g"),
        label,
      });
    } catch (err: any) {
      process.stderr.write(`baton: warning: invalid regex in ${path}:${i + 1}: ${err.message}\n`);
    }
  }

  return patterns;
}

export function loadUserPatterns(userHome: string): RedactPattern[] {
  const path = join(userHome, ".claude", "baton-ignore");
  return parseIgnoreFile(path);
}

export function loadProjectPatterns(cwd: string): RedactPattern[] {
  const path = join(cwd, ".batonignore");
  return parseIgnoreFile(path);
}

export function redact(body: string, patterns: RedactPattern[]): { body: string; hits: Array<{ label: string; count: number }> } {
  if (process.env.BATON_NO_REDACT === "1") {
    process.stderr.write("baton: notice: redaction disabled via BATON_NO_REDACT=1\n");
    return { body, hits: [] };
  }

  let redactedBody = body;
  const hitCounts = new Map<string, number>();

  for (const pattern of patterns) {
    let matchCount = 0;

    redactedBody = redactedBody.replace(pattern.regex, (match, ...args) => {
      matchCount++;
      // If there are capturing groups and the first group is a string (key name) and second is the value
      // we only redact the value. The regex signature might be different depending on whether
      // the regex uses capturing groups.
      // String.prototype.replace callback arguments: match, p1, p2, ..., offset, string

      // We can count capturing groups. The generic KEY=value pattern has 2 capturing groups.
      // AWS secret has 1 capturing group.

      if (args.length >= 4 && typeof args[0] === 'string' && typeof args[1] === 'string') {
        // Assume first two args are p1 and p2
        // Find if this looks like our generic KEY=value pattern
        if (match.includes(args[0]) && match.includes(args[1])) {
           // We just replace the value part (args[1]) with redacted label
           // We need to carefully replace args[1] in the original match string, but there could be issues
           // if the key and value are the same. A safer approach for the specific patterns:
           return match.replace(args[1], `[redacted ${pattern.label}]`);
        }
      }

      // AWS secret pattern has 1 capture group: args.length >= 3 and args[0] is string
      if (pattern.label === "AWS secret access key" && args.length >= 3 && typeof args[0] === 'string') {
        return match.replace(args[0], `[redacted ${pattern.label}]`);
      }

      // Default: replace whole match
      return `[redacted ${pattern.label}]`;
    });

    if (matchCount > 0) {
      hitCounts.set(pattern.label, (hitCounts.get(pattern.label) || 0) + matchCount);
    }
  }

  const hits = Array.from(hitCounts.entries()).map(([label, count]) => ({ label, count }));
  return { body: redactedBody, hits };
}
