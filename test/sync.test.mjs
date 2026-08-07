import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

// the in-process library bundle (NOT dist/index.js, which is the hook-only entry)
const dist = pathToFileURL(join(process.cwd(), "dist", "lib.js")).href;

function makeHome() {
  const dir = mkdtempSync(join(tmpdir(), "sb-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  return dir;
}

// A home only resolves if it is registered in the apps.json that HUB_APPS_FILE points
// at (the registry is data-driven, with no built-in app descriptors). Pointing only the
// per-app env vars at a temp dir is not enough, and relying on the developer's own
// registry makes these tests pass locally and fail anywhere else.
function registerApps(homesById) {
  const appsDir = mkdtempSync(join(tmpdir(), "sb-apps-"));
  const entries = {};
  for (const [id, home] of Object.entries(homesById)) {
    entries[id] = { id, label: id, home: { candidates: [home] } };
  }
  writeFileSync(join(appsDir, "apps.json"), JSON.stringify(entries), "utf8");
  process.env.HUB_APPS_FILE = join(appsDir, "apps.json");
}

function writeStore(home, store, mtimeSeconds) {
  const file = join(home, "config", "accounts.json");
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
  if (mtimeSeconds) utimesSync(file, mtimeSeconds, mtimeSeconds);
  return file;
}

function pool(accounts) {
  return { version: 1, providers: { antigravity: { accounts, activeIndex: 0, activeIndexByLane: {} } } };
}

function writePlugins(home, entries) {
  writeFileSync(join(home, "config", "plugins.json"), JSON.stringify(entries, null, 2), "utf8");
}

function readPlugins(home) {
  return JSON.parse(readFileSync(join(home, "config", "plugins.json"), "utf8"));
}

test("accounts strategy unions the account store across both homes, newest fields win", async () => {
  const claude = makeHome();
  const opencode = makeHome();
  process.env.HUB_CLAUDE_DIR = claude;
  process.env.HUB_OPENCODE_DIR = opencode;
  registerApps({ claude, opencode });

  // claude (older): a1, a2(lastUsed 100). opencode (newer): a2(lastUsed 200), a3
  writeStore(claude, pool([
    { id: "a1@x", refresh: "r1", lastUsed: 50 },
    { id: "a2@x", refresh: "r2", lastUsed: 100, meta: { projectId: "p2" } },
  ]), 1000);
  writeStore(opencode, pool([
    { id: "a2@x", refresh: "r2", lastUsed: 200, meta: { managedProjectId: "m2" } },
    { id: "a3@x", refresh: "r3", lastUsed: 300 },
  ]), 2000);

  const mod = await import(dist);
  const result = mod.syncFile("accounts.json", { strategy: "accounts" });
  expect(result.synced).toBe(true);
  expect(result.homes).toBe(2);

  for (const home of [claude, opencode]) {
    const store = JSON.parse(readFileSync(join(home, "config", "accounts.json"), "utf8"));
    const accounts = store.providers.antigravity.accounts;
    const ids = accounts.map((a) => a.id).sort();
    expect(ids).toEqual(["a1@x", "a2@x", "a3@x"]);
    const a2 = accounts.find((a) => a.id === "a2@x");
    expect(a2.lastUsed).toBe(200);
    expect(a2.meta.projectId).toBe("p2");
    expect(a2.meta.managedProjectId).toBe("m2");
  }

  rmSync(claude, { recursive: true, force: true });
  rmSync(opencode, { recursive: true, force: true });
});

test("syncFile newest strategy copies the most recent version", async () => {
  const claude = makeHome();
  const opencode = makeHome();
  process.env.HUB_CLAUDE_DIR = claude;
  process.env.HUB_OPENCODE_DIR = opencode;
  registerApps({ claude, opencode });
  writeFileSync(join(claude, "config", "plug.json"), "OLD", "utf8");
  utimesSync(join(claude, "config", "plug.json"), 1000, 1000);
  writeFileSync(join(opencode, "config", "plug.json"), "NEW", "utf8");
  utimesSync(join(opencode, "config", "plug.json"), 2000, 2000);

  const mod = await import(dist);
  const result = mod.syncFile("config/plug.json", { strategy: "newest" });
  expect(result.synced).toBe(true);
  expect(readFileSync(join(claude, "config", "plug.json"), "utf8")).toBe("NEW");

  rmSync(claude, { recursive: true, force: true });
  rmSync(opencode, { recursive: true, force: true });
});

test("syncPlugins mirrors only the entries that ask for it, per-home", async () => {
  const claude = makeHome();
  const opencode = makeHome();
  process.env.HUB_CLAUDE_DIR = claude;
  process.env.HUB_OPENCODE_DIR = opencode;
  registerApps({ claude, opencode });

  // claude: A asks to sync, B says nothing, D opts out. opencode: C says nothing.
  writePlugins(claude, [
    { name: "plugin-a", url: "u/a", enabled: true, autoUpdate: false, sync: true },
    { name: "plugin-b", url: "u/b", enabled: true, autoUpdate: false },
    { name: "plugin-d", url: "u/d", enabled: true, autoUpdate: false, sync: false },
  ]);
  writePlugins(opencode, [
    { name: "plugin-c", url: "u/c", enabled: true, autoUpdate: false },
  ]);

  const mod = await import(dist);
  const result = mod.syncPlugins();
  expect(result.synced).toBe(true);

  // Only A crosses. B and C never asked, so each stays in the home it was added to.
  const claudeNames = readPlugins(claude).map((e) => e.name).sort();
  const opencodeNames = readPlugins(opencode).map((e) => e.name).sort();
  expect(claudeNames).toEqual(["plugin-a", "plugin-b", "plugin-d"]);
  expect(opencodeNames).toEqual(["plugin-a", "plugin-c"]);

  // idempotent: a second pass adds nothing
  const again = mod.syncPlugins();
  expect(again.added).toEqual({});

  rmSync(claude, { recursive: true, force: true });
  rmSync(opencode, { recursive: true, force: true });
});

test("no-op when fewer than two homes exist", async () => {
  const only = makeHome();
  process.env.HUB_CLAUDE_DIR = only;
  process.env.HUB_OPENCODE_DIR = join(tmpdir(), "sb-does-not-exist-xyz");
  const mod = await import(dist);
  const result = mod.syncFile("accounts.json", { strategy: "accounts" });
  expect(result.synced).toBe(false);
  rmSync(only, { recursive: true, force: true });
});
