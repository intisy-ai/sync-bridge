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
import { drainHomes } from "../../core/src/index.js";

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

// Two existing built-in homes with a config/ dir each. HUB_APPS_FILE points at a
// missing file so the registry yields only the two built-ins (never the real
// ~/.config/cairn/apps.json), keeping the home set deterministic and isolated.
function twoHomes(): { claude: string; opencode: string } {
  stashEnv();
  const claude = tmp("sb-c-");
  const opencode = tmp("sb-o-");
  mkdirSync(join(claude, "config"), { recursive: true });
  mkdirSync(join(opencode, "config"), { recursive: true });
  process.env.HUB_CLAUDE_DIR = claude;
  process.env.HUB_OPENCODE_DIR = opencode;
  process.env.HUB_APPS_FILE = join(tmp("sb-noapps-"), "none.json");
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

    const events: { topic: string; payload: { name?: string } }[] = [];
    drainHomes([claude, opencode], "bus-c", (e: typeof events[number]) => events.push(e));
    expect(events.some((e) => e.topic === "config.changed" && e.payload.name === "config/settings.json")).toBe(true);
  });

  it("emits sync.completed summarizing a pass that changed something", () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));
    syncAll();

    const events: { topic: string; payload: { files?: string[] } }[] = [];
    drainHomes([claude, opencode], "bus-s", (e: typeof events[number]) => events.push(e));
    const done = events.find((e) => e.topic === "sync.completed");
    expect(done).toBeTruthy();
    expect(done!.payload.files).toContain("config/settings.json");
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
  it("includes a home registered in apps.json alongside the built-ins", () => {
    stashEnv();
    const claude = tmp("sb-claude-");
    const opencode = tmp("sb-opencode-");
    const acme = tmp("sb-acme-");
    const appsDir = tmp("sb-apps-");
    writeFileSync(join(appsDir, "apps.json"), JSON.stringify({
      acme: { id: "acme", label: "Acme", home: { candidates: [acme] } },
    }));
    process.env.HUB_CLAUDE_DIR = claude;
    process.env.HUB_OPENCODE_DIR = opencode;
    process.env.HUB_APPS_FILE = join(appsDir, "apps.json");

    const homes = existingHomes();
    expect(homes).toContain(claude);
    expect(homes).toContain(opencode);
    expect(homes).toContain(acme);
  });

  it("falls back to the built-in homes when apps.json is absent", () => {
    stashEnv();
    const claude = tmp("sb-claude-");
    const opencode = tmp("sb-opencode-");
    process.env.HUB_CLAUDE_DIR = claude;
    process.env.HUB_OPENCODE_DIR = opencode;
    process.env.HUB_APPS_FILE = join(tmp("sb-empty-"), "missing.json");

    expect(existingHomes().sort()).toEqual([claude, opencode].sort());
  });
});

describe("plugin sync all-by-default", () => {
  it("mirrors every entry across homes and skips sync:false", () => {
    stashEnv();
    const claude = tmp("sb-c-");
    const opencode = tmp("sb-o-");
    mkdirSync(join(claude, "config"), { recursive: true });
    mkdirSync(join(opencode, "config"), { recursive: true });
    writeFileSync(join(claude, "config", "plugins.json"), JSON.stringify([
      { name: "alpha", url: "u1", enabled: true },
      { name: "private-one", url: "u2", sync: false },
    ]));
    writeFileSync(join(opencode, "config", "plugins.json"), JSON.stringify([]));
    process.env.HUB_CLAUDE_DIR = claude;
    process.env.HUB_OPENCODE_DIR = opencode;
    process.env.HUB_APPS_FILE = join(tmp("sb-noapps-"), "none.json");

    const result = syncPlugins();
    expect(result.synced).toBe(true);
    const opencodeEntries = JSON.parse(readFileSync(join(opencode, "config", "plugins.json"), "utf8"));
    const names = opencodeEntries.map((e: { name: string }) => e.name);
    expect(names).toContain("alpha");
    expect(names).not.toContain("private-one");
  });
});
