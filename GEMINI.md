# GEMINI.md

This file provides guidance to Gemini CLI when working with the `baton` codebase.

## Project Overview

**baton** (published as `ccbaton` on npm) is a snapshot-and-resume tool for Claude Code. It helps users preserve context across sessions by writing a structured `BATON.md` file containing the current working state. This prevents context loss due to Claude Code's auto-compaction.

### Core Technologies
- **Runtime:** Node.js (>=20) for published installs; Bun for local development.
- **Language:** TypeScript.
- **Build System:** Bun (used for bundling, testing, and running scripts).
- **Primary Integration:** Claude Code (patches `~/.claude/settings.json`).

## Building and Running

### Development Commands
```bash
bun install          # Install dependencies
bun test             # Run all tests using Bun's test runner
bun test <path>      # Run a specific test file
bun run build        # Bundle the project to dist/cli.js (Node-portable)
bun run typecheck    # Run TypeScript compiler for type checking (tsc --noEmit)
bun run src/cli.ts install     # Install from source into ~/.claude/
bun run src/cli.ts uninstall   # Remove baton hooks and restore settings.json
bun run src/cli.ts check       # Verify current installation state
bun run src/cli.ts sidecar gemini --mode review --dry-run
```

### Production usage (via `ccbaton` npm package)
- `npx ccbaton@latest`: Installs/upgrades the tool.
- `baton catch`: Resumes from the nearest `BATON.md`.
- `baton drop`: Archives the current `BATON.md` to start fresh.

## Architecture

The project is structured into modular components:

- **`src/cli.ts`**: The main entry point. Dispatches subcommands for the statusline, hooks, installation, and baton lifecycle management.
- **`src/hooks/`**: Implements Claude Code hook handlers:
    - `session-start.ts`: Injects `BATON.md` content on session start.
    - `user-prompt-submit.ts`: Nudges the user/model to snapshot when context thresholds are reached.
    - `pre-compact.ts`: Intercepts auto-compaction and writes a fallback baton if needed.
- **`src/statusline/`**: Logic for rendering the compact Claude Code status bar, including token usage gauges and session metadata.
- **`src/baton/`**: Core logic for baton creation, archiving, redaction, and template loading.
- **`src/install/`**: Idempotent installation logic that patches `~/.claude/settings.json`.
- **`src/sidecar/`**: Headless second-opinion runners for Codex and Gemini. Hosts share `run.ts`, mode prompts live in `prompts.ts`, and host-specific argv construction lives in `codex.ts` and `gemini.ts`.
- **`src/transcript/`**: Utilities for parsing Claude Code's JSONL transcript files.

## Development Conventions

### Coding Style & Patterns
- **Non-Interactive CLI**: All subcommands are designed to be non-interactive, reading from `stdin` or CLI arguments.
- **Output**: Prefer `process.stdout.write` and `process.stderr.write` over `console.log` for precise control over output (e.g., for the statusline).
- **Self-Locating Commands**: The `buildCommand()` utility in `src/config.ts` ensures hooks use absolute paths to remain functional regardless of where the CLI was invoked.
- **Idempotency**: Installation and patching logic must be idempotent, allowing safe repeated execution.
- **Sidecars are read-only**: Codex uses `--sandbox read-only --ephemeral`; Gemini uses `--approval-mode plan`. Do not add write-capable sidecar behavior without explicit product intent and tests.

### Testing Practices
- **Framework**: Use Bun's built-in test runner (`bun test`).
- **File-System Focused**: Tests typically interact with the real file system using temporary directories (`mkdtempSync`) rather than extensive mocking.
- **Fixtures**: Use `test/fixtures.ts` to generate synthetic Claude Code transcripts for testing parsing and token counting logic.

### Design Decisions
- **Token Counting**: Only the most recent main-chain assistant message's `usage` field is used to determine current context size to avoid double-counting cached tokens.
- **PreCompact Blocking**: The `PreCompact` hook always returns `{ decision: "block" }` to prevent Claude Code's native compaction, instead relying on the baton for context preservation.
- **Redaction**: A fallback redaction step is applied to auto-generated batons to prevent accidental leakage of secrets (API keys, tokens, etc.).
