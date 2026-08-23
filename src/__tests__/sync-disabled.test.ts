import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { syncAll } from "../run.js";
import { crossAppSync } from "../plugin.js";
import { installCoreRuntime } from "../runtime-core.js";

// The engine takes its homes, logging and ledger from whoever runs it; a test runs it as the
// program half does, so it installs the same core-backed runtime.
installCoreRuntime();

// Its own file on purpose: sync-bridge caches its config on first read, for the life of the
// process, so a test that needs a config read at all must be the only one in its module registry.
const ENV_KEYS = ["HUB_CLAUDE_DIR", "HUB_OPENCODE_DIR", "HUB_APPS_FILE", "HUB_CONFIG_DIR", "XDG_CONFIG_HOME"];
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("a pass the config switched off", () => {
  it("moves nothing, and the capability says nothing moved", async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    const claude = mkdtempSync(join(tmpdir(), "sb-off-c-"));
    const opencode = mkdtempSync(join(tmpdir(), "sb-off-o-"));
    mkdirSync(join(claude, "config"), { recursive: true });
    mkdirSync(join(opencode, "config"), { recursive: true });
    const appsDir = mkdtempSync(join(tmpdir(), "sb-off-apps-"));
    writeFileSync(join(appsDir, "apps.json"), JSON.stringify({
      claude: { id: "claude", label: "claude", home: { candidates: [claude] } },
      opencode: { id: "opencode", label: "opencode", home: { candidates: [opencode] } },
    }));
    process.env.HUB_APPS_FILE = join(appsDir, "apps.json");
    process.env.HUB_CONFIG_DIR = opencode;
    writeFileSync(join(opencode, "config", "sync-bridge.json"), JSON.stringify({ enabled: false }));
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));

    expect(syncAll()).toMatchObject({ enabled: false });
    expect(existsSync(join(opencode, "config", "settings.json"))).toBe(false);

    const result = await crossAppSync().sync();
    expect(result.files).toEqual([]);
    expect(result.plugins).toEqual([]);
  });
});
