import { expect, test, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { TEST_HOME } from "./helpers/test-home.ts";

const actualConfig = await import("../src/config.ts");
const TEST_CLI_PATH = "/some/baton/src/cli.ts";

mock.module("../src/config.ts", () => ({
  ...actualConfig,
  cliPath: () => TEST_CLI_PATH,
  buildCommand: (sub: string) => `bun run "${TEST_CLI_PATH}" ${sub}`,
}));

const {
  backupCcstatusline,
  listCcstatuslineBackups,
  restoreCcstatusline,
  preBatonCcstatuslineSnapshot,
} = await import("../src/install/ccstatusline-backup.ts");
const { install } = await import("../src/install/settings-patch.ts");

const CCS_DIR = join(TEST_HOME, ".config", "ccstatusline");
const CCS_PATH = join(CCS_DIR, "settings.json");
const BACKUP_DIR = join(TEST_HOME, ".claude", "baton", "ccstatusline-backups");

function seedCcstatusline(body: string): void {
  mkdirSync(CCS_DIR, { recursive: true });
  writeFileSync(CCS_PATH, body, "utf8");
}

beforeEach(() => {
  rmSync(join(TEST_HOME, ".claude"), { recursive: true, force: true });
  rmSync(join(TEST_HOME, ".config"), { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  rmSync(join(TEST_HOME, ".claude"), { recursive: true, force: true });
  rmSync(join(TEST_HOME, ".config"), { recursive: true, force: true });
});

test("backup writes a timestamped copy when ccstatusline settings exist", () => {
  seedCcstatusline('{"version":3}');
  const outcome = backupCcstatusline();
  expect(outcome.sourceExisted).toBe(true);
  if (!outcome.sourceExisted) return;
  expect(existsSync(outcome.backupPath)).toBe(true);
  expect(readFileSync(outcome.backupPath, "utf8")).toBe('{"version":3}');
  expect(outcome.backupPath).toMatch(/settings-\d{4}-\d{2}-\d{2}T.*\.json$/);
  expect(outcome.backupPath.startsWith(BACKUP_DIR + "/")).toBe(true);
});

test("backup skips when ccstatusline settings file does not exist", () => {
  const outcome = backupCcstatusline();
  expect(outcome.sourceExisted).toBe(false);
});

test("backup --out writes to the explicit path", () => {
  seedCcstatusline('{"version":3,"hello":"world"}');
  const out = join(TEST_HOME, "elsewhere", "ccs.json");
  const outcome = backupCcstatusline({ out });
  expect(outcome.sourceExisted).toBe(true);
  if (!outcome.sourceExisted) return;
  expect(outcome.backupPath).toBe(out);
  expect(readFileSync(out, "utf8")).toBe('{"version":3,"hello":"world"}');
});

test("listBackups returns entries newest-first", async () => {
  seedCcstatusline('{"v":1}');
  const a = backupCcstatusline();
  expect(a.sourceExisted).toBe(true);
  // ensure mtime separation
  await new Promise((r) => setTimeout(r, 10));
  seedCcstatusline('{"v":2}');
  const b = backupCcstatusline();
  expect(b.sourceExisted).toBe(true);

  const entries = listCcstatuslineBackups();
  expect(entries).toHaveLength(2);
  expect(entries[0]!.mtimeMs).toBeGreaterThanOrEqual(entries[1]!.mtimeMs);
});

test("restore with no arg replaces settings with the latest backup", () => {
  seedCcstatusline('{"v":"original"}');
  backupCcstatusline();
  seedCcstatusline('{"v":"corrupted"}');

  const result = restoreCcstatusline();
  expect(readFileSync(CCS_PATH, "utf8")).toBe('{"v":"original"}');
  expect(result.preRestoreBackupPath).not.toBeNull();
  if (result.preRestoreBackupPath) {
    expect(readFileSync(result.preRestoreBackupPath, "utf8")).toBe('{"v":"corrupted"}');
  }
});

test("restore with an explicit path uses that file", () => {
  seedCcstatusline('{"v":"current"}');
  const externalBackup = join(TEST_HOME, "saved.json");
  writeFileSync(externalBackup, '{"v":"external"}', "utf8");

  const result = restoreCcstatusline({ from: externalBackup });
  expect(readFileSync(CCS_PATH, "utf8")).toBe('{"v":"external"}');
  expect(result.fromPath).toBe(externalBackup);
});

test("restore throws when no backups exist", () => {
  expect(() => restoreCcstatusline()).toThrow(/No ccstatusline backups found/);
});

test("restore throws when the supplied backup path does not exist", () => {
  expect(() => restoreCcstatusline({ from: "/nope.json" })).toThrow(/Backup not found/);
});

test("restore writes destination even when ccstatusline dir is missing", () => {
  // No ccstatusline file currently exists.
  const src = join(TEST_HOME, "from.json");
  writeFileSync(src, '{"v":"from-anywhere"}', "utf8");
  const result = restoreCcstatusline({ from: src });
  expect(readFileSync(CCS_PATH, "utf8")).toBe('{"v":"from-anywhere"}');
  expect(result.preRestoreBackupPath).toBeNull();
});

test("preBatonCcstatuslineSnapshot returns null when no ccstatusline config exists", () => {
  expect(preBatonCcstatuslineSnapshot()).toBeNull();
});

test("preBatonCcstatuslineSnapshot writes a settings-pre-baton-* backup", () => {
  seedCcstatusline('{"v":"before-baton"}');
  const path = preBatonCcstatuslineSnapshot();
  expect(path).not.toBeNull();
  if (!path) return;
  expect(path).toMatch(/settings-pre-baton-.*\.json$/);
  expect(readFileSync(path, "utf8")).toBe('{"v":"before-baton"}');
});

test("install captures a one-shot ccstatusline snapshot on first install", () => {
  seedCcstatusline('{"v":"before-baton"}');
  const report = install();
  expect(report.ccstatuslineBackupPath).not.toBeNull();
  if (!report.ccstatuslineBackupPath) return;
  expect(readFileSync(report.ccstatuslineBackupPath, "utf8")).toBe('{"v":"before-baton"}');
});

test("install does not re-snapshot ccstatusline on second install", () => {
  seedCcstatusline('{"v":"before-baton"}');
  install();
  // mutate config (simulating user edits after install)
  seedCcstatusline('{"v":"user-edited"}');
  const report2 = install();
  expect(report2.ccstatuslineBackupPath).toBeNull();

  const entries = listCcstatuslineBackups();
  expect(entries).toHaveLength(1);
  expect(readFileSync(entries[0]!.path, "utf8")).toBe('{"v":"before-baton"}');
});

test("install reports no ccstatusline backup when no ccstatusline config exists", () => {
  const report = install();
  expect(report.ccstatuslineBackupPath).toBeNull();
});

test("XDG_CONFIG_HOME override is honored", () => {
  const xdg = join(TEST_HOME, "xdg");
  mkdirSync(join(xdg, "ccstatusline"), { recursive: true });
  writeFileSync(join(xdg, "ccstatusline", "settings.json"), '{"v":"xdg"}', "utf8");
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    const outcome = backupCcstatusline();
    expect(outcome.sourceExisted).toBe(true);
    if (!outcome.sourceExisted) return;
    expect(readFileSync(outcome.backupPath, "utf8")).toBe('{"v":"xdg"}');
  } finally {
    delete process.env.XDG_CONFIG_HOME;
    rmSync(xdg, { recursive: true, force: true });
  }
});

test("CLI: ccstatusline-backup end-to-end", () => {
  const homeDir = join(TEST_HOME, "cli-ccs-backup");
  rmSync(homeDir, { recursive: true, force: true });
  mkdirSync(join(homeDir, ".config", "ccstatusline"), { recursive: true });
  writeFileSync(join(homeDir, ".config", "ccstatusline", "settings.json"), '{"v":"cli"}', "utf8");

  const cliPath = join(import.meta.dir, "..", "src", "cli.ts");
  const result = spawnSync("bun", ["run", cliPath, "ccstatusline-backup"], {
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, XDG_CONFIG_HOME: "" },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("ccstatusline backed up");
  rmSync(homeDir, { recursive: true, force: true });
});

test("CLI: ccstatusline-restore --list reports empty when no backups exist", () => {
  const homeDir = join(TEST_HOME, "cli-ccs-restore-empty");
  rmSync(homeDir, { recursive: true, force: true });
  mkdirSync(homeDir, { recursive: true });

  const cliPath = join(import.meta.dir, "..", "src", "cli.ts");
  const result = spawnSync("bun", ["run", cliPath, "ccstatusline-restore", "--list"], {
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, XDG_CONFIG_HOME: "" },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("No ccstatusline backups found");
  rmSync(homeDir, { recursive: true, force: true });
});

test("CLI: ccstatusline-restore fails clearly when there is nothing to restore", () => {
  const homeDir = join(TEST_HOME, "cli-ccs-restore-fail");
  rmSync(homeDir, { recursive: true, force: true });
  mkdirSync(homeDir, { recursive: true });

  const cliPath = join(import.meta.dir, "..", "src", "cli.ts");
  const result = spawnSync("bun", ["run", cliPath, "ccstatusline-restore"], {
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, XDG_CONFIG_HOME: "" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("No ccstatusline backups found");
  rmSync(homeDir, { recursive: true, force: true });
});
