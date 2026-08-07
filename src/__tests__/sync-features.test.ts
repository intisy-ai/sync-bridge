import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { accounts } from "../merge.js";
import { existingHomes } from "../homes.js";
import { syncFile } from "../sync.js";
import { syncAll } from "../run.js";
import { syncPlugins } from "../pluginsync.js";
import { withSyncLock } from "../lock.js";
import { drainHomes, readActivity } from "@intisy-ai/core";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const ENV_KEYS = ["HUB_CLAUDE_DIR", "HUB_OPENCODE_DIR", "HUB_APPS_FILE", "HUB_CONFIG_DIR", "XDG_CONFIG_HOME"];
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function stashEnv(): void {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
}

// core's app registry is fully data-driven (no built-in app descriptors): a home
// only resolves if it is registered in the apps.json that HUB_APPS_FILE points at.
// Each call writes a fresh apps.json under a new temp dir, so getApps()'s
// file-path+mtime cache never bleeds a stale entry into the next test.
function registerApps(homesById: Record<string, string>, loaders: Record<string, string> = {}): void {
  const appsDir = tmp("sb-apps-");
  const entries: Record<string, unknown> = {};
  for (const [id, home] of Object.entries(homesById)) {
    entries[id] = { id, label: id, home: { candidates: [home] }, loader: loaders[id] ? { id: loaders[id], url: "u" } : undefined };
  }
  writeFileSync(join(appsDir, "apps.json"), JSON.stringify(entries));
  process.env.HUB_APPS_FILE = join(appsDir, "apps.json");
}

// Two homes with a config/ dir each, registered via apps.json.
function twoHomes(): { claude: string; opencode: string } {
  stashEnv();
  const claude = tmp("sb-c-");
  const opencode = tmp("sb-o-");
  mkdirSync(join(claude, "config"), { recursive: true });
  mkdirSync(join(opencode, "config"), { recursive: true });
  registerApps({ claude, opencode });
  process.env.HUB_CONFIG_DIR = opencode; // where bus events land for these tests
  return { claude, opencode };
}

describe("reconcile", () => {
  it("reconciles the newest version across homes and preserves every key", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "foo.json"), JSON.stringify({ max_tokens: 100, theme: "light" }));
    const newerPath = join(opencode, "config", "foo.json");
    writeFileSync(newerPath, JSON.stringify({ max_tokens: 200, theme: "dark", apiToken: "keep-me" }));
    const future = Date.now() / 1000 + 100;
    utimesSync(newerPath, future, future);

    const res = syncFile("config/foo.json", { strategy: "newest" });
    expect(res.synced).toBe(true);
    // The newer version wins on both homes, and secret-named keys are NOT stripped.
    expect(JSON.parse(readFileSync(join(claude, "config", "foo.json"), "utf8")))
      .toEqual({ max_tokens: 200, theme: "dark", apiToken: "keep-me" });
  });

  it("never overwrites a present-but-unreadable file", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "foo.json"), JSON.stringify({ a: 1 }));
    // A directory at the target path exists but cannot be read as a file.
    mkdirSync(join(opencode, "config", "foo.json"), { recursive: true });

    const res = syncFile("config/foo.json", { strategy: "newest", create: true });
    expect(res.synced).toBe(true);
    expect(statSync(join(opencode, "config", "foo.json")).isDirectory()).toBe(true);
  });

  it("does not create a reconciled file in a home that lacks it when create is off", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "plug.json"), JSON.stringify({ a: 1 }));

    syncFile("config/plug.json", { strategy: "newest" });
    expect(existsSync(join(opencode, "config", "plug.json"))).toBe(false);
  });

  it("propagates a file into a home that lacks it when create is on", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));

    syncFile("config/settings.json", { strategy: "newest", create: true });
    expect(JSON.parse(readFileSync(join(opencode, "config", "settings.json"), "utf8")))
      .toEqual({ logConsole: true });
  });
});

describe("bus events", () => {
  it("emits config.changed when a file is reconciled", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));
    syncFile("config/settings.json", { strategy: "newest", create: true });

    const events: { topic: string; payload: { details?: { file?: string } } }[] = [];
    drainHomes([claude, opencode], "bus-c", (e: typeof events[number]) => events.push(e));
    expect(events.some((e) => e.topic === "config.changed" && e.payload.details?.file === "config/settings.json")).toBe(true);
  });

  it("records a reconciled file as a normalized config change, with an origin", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));
    syncFile("config/settings.json", { strategy: "newest", create: true });

    const { records } = readActivity([claude, opencode], { topics: ["config.changed"] });
    const rec = records.find((r) => r.details.file === "config/settings.json");
    expect(rec).toBeDefined();
    expect(rec!.action).toBe("config_changed");
    expect(rec!.outcome).toBe("ok");
    expect(rec!.source).toBe("sync-bridge");
    // a raw publish carries no origin at all, so this is what proves the channel changed
    expect(rec!.origin.home.length).toBeGreaterThan(0);
    expect(rec!.details.homes).toBeGreaterThan(0);
  });

  it("summarizes a completed pass in a line a generic renderer can show", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));
    syncAll();

    const { records } = readActivity([claude, opencode], { topics: ["sync.completed"] });
    const done = records.find((r) => r.action === "sync_completed");
    expect(done!.outcome).toBe("ok");
    expect(done!.details.message).toContain("1 file");
  });

  it("emits a sync_completed activity summarizing a pass that changed something", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));
    syncAll();

    const { records } = readActivity([claude, opencode], { topics: ["sync.completed"] });
    const done = records.find((r) => r.action === "sync_completed");
    expect(done).toBeTruthy();
    expect(done!.details.files).toContain("config/settings.json");
  });
});

describe("sync lock", () => {
  it("runs the body while holding the lock, then releases it", () => {
    twoHomes();
    expect(withSyncLock(() => 42)).toBe(42);
    expect(withSyncLock(() => 7)).toBe(7);
  });

  it("skips the body when a fresh lock is already held", () => {
    const { opencode } = twoHomes();
    writeFileSync(join(opencode, "config", "sync-bridge.lock"), "");
    let ran = false;
    const result = withSyncLock(() => { ran = true; return 1; });
    expect(ran).toBe(false);
    expect(result).toBeNull();
  });

  it("takes over a stale lock", () => {
    const { opencode } = twoHomes();
    const lock = join(opencode, "config", "sync-bridge.lock");
    writeFileSync(lock, "");
    const old = Date.now() / 1000 - 120;
    utimesSync(lock, old, old);
    expect(withSyncLock(() => "took over")).toBe("took over");
  });
});

describe("accounts strategy", () => {
  it("unions accounts and clamps a stale activeIndex into the merged list", () => {
    const a = JSON.stringify({ version: 1, providers: { p: { accounts: [{ id: "x" }], activeIndex: 0 } } });
    const b = JSON.stringify({ version: 1, providers: { p: { accounts: [{ id: "y" }], activeIndex: 5 } } });
    const merged = JSON.parse(accounts([{ data: a, mtimeMs: 1 }, { data: b, mtimeMs: 2 }]));
    expect(merged.providers.p.accounts.map((acc: { id: string }) => acc.id).sort()).toEqual(["x", "y"]);
    expect(merged.providers.p.activeIndex).toBe(1);
  });
});

describe("registry-aware homes", () => {
  it("includes every home registered in apps.json", () => {
    stashEnv();
    const claude = tmp("sb-claude-");
    const opencode = tmp("sb-opencode-");
    const acme = tmp("sb-acme-");
    registerApps({ claude, opencode, acme });

    const homes = existingHomes();
    expect(homes).toContain(claude);
    expect(homes).toContain(opencode);
    expect(homes).toContain(acme);
  });

  it("returns no homes when apps.json is absent (core has no built-in app fallback)", () => {
    stashEnv();
    process.env.HUB_APPS_FILE = join(tmp("sb-empty-"), "missing.json");

    expect(existingHomes()).toEqual([]);
  });
});

describe("plugin sync", () => {
  function twoHomes(claudeEntries: unknown[], opencodeEntries: unknown[] = [], loaders: Record<string, string> = {}) {
    stashEnv();
    const claude = tmp("sb-c-");
    const opencode = tmp("sb-o-");
    mkdirSync(join(claude, "config"), { recursive: true });
    mkdirSync(join(opencode, "config"), { recursive: true });
    writeFileSync(join(claude, "config", "plugins.json"), JSON.stringify(claudeEntries));
    writeFileSync(join(opencode, "config", "plugins.json"), JSON.stringify(opencodeEntries));
    registerApps({ claude, opencode }, loaders);
    return { claude, opencode };
  }
  const namesIn = (home: string) =>
    JSON.parse(readFileSync(join(home, "config", "plugins.json"), "utf8")).map((e: { name: string }) => e.name);

  it("mirrors an entry that asks to be synced", () => {
    const { opencode } = twoHomes([{ name: "alpha", url: "u1", enabled: true, sync: true }]);
    expect(syncPlugins().synced).toBe(true);
    expect(namesIn(opencode)).toContain("alpha");
  });

  // Most plugins suit one app. Mirroring an entry that never asked is how each app's plugins
  // ended up installed in the other, so silence means stay put.
  it("leaves an entry that says nothing where it is", () => {
    const { opencode } = twoHomes([
      { name: "opencode-cursor", url: "u1" },
      { name: "private-one", url: "u2", sync: false },
    ]);
    expect(syncPlugins().synced).toBe(true);
    expect(namesIn(opencode)).toEqual([]);
  });

  // A loader is reached by exactly one app, so mirroring it promises an install that can
  // never load, whatever the entry asks for.
  it("never mirrors a loader into another app's home", () => {
    const { claude, opencode } = twoHomes(
      [],
      [{ name: "opencode-loader", url: "u1", sync: true }],
      { claude: "claude-code-loader", opencode: "opencode-loader" },
    );
    expect(syncPlugins().synced).toBe(true);
    expect(namesIn(claude)).toEqual([]);
    expect(namesIn(opencode)).toContain("opencode-loader");
  });

});
