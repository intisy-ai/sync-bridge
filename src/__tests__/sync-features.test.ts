import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scrubSecrets, scrubText } from "../secrets.js";
import { newestSafe } from "../merge.js";
import { existingHomes } from "../homes.js";
import { syncPlugins } from "../pluginsync.js";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const ENV_KEYS = ["HUB_CLAUDE_DIR", "HUB_OPENCODE_DIR", "HUB_APPS_FILE", "XDG_CONFIG_HOME"];
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

describe("secret scrubbing", () => {
  it("drops secret-looking keys at any depth, keeps safe keys", () => {
    const out = scrubSecrets({ theme: "dark", apiKey: "sk-1", nested: { token: "t", label: "ok" }, list: [{ password: "p", n: 1 }] });
    expect(out).toEqual({ theme: "dark", nested: { label: "ok" }, list: [{ n: 1 }] });
  });

  it("scrubText round-trips JSON and drops secrets", () => {
    const text = JSON.stringify({ logConsole: true, accessToken: "x" });
    const scrubbed = JSON.parse(scrubText(text));
    expect(scrubbed).toEqual({ logConsole: true });
  });

  it("newest-safe returns the newest version scrubbed", () => {
    const result = newestSafe([
      { data: JSON.stringify({ a: 1, secret: "old" }), mtimeMs: 1 },
      { data: JSON.stringify({ a: 2, secret: "new" }), mtimeMs: 2 },
    ]);
    expect(JSON.parse(result)).toEqual({ a: 2 });
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
    delete process.env.HUB_APPS_FILE;

    const result = syncPlugins();
    expect(result.synced).toBe(true);
    const opencodeEntries = JSON.parse(readFileSync(join(opencode, "config", "plugins.json"), "utf8"));
    const names = opencodeEntries.map((e: { name: string }) => e.name);
    expect(names).toContain("alpha");
    expect(names).not.toContain("private-one");
  });
});
