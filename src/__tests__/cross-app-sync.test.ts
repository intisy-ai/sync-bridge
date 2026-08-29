import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readActivity } from "@intisy-ai/basekit";
import { crossAppSync } from "../plugin.js";
import { installCoreRuntime } from "../runtime-core.js";

// The engine takes its homes, logging and ledger from whoever runs it; a test runs it as the
// program half does, so it installs the same basekit-backed runtime.
installCoreRuntime();

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const ENV_KEYS = ["HUB_CLAUDE_DIR", "HUB_OPENCODE_DIR", "HUB_APPS_FILE", "HUB_CONFIG_DIR", "XDG_CONFIG_HOME"];
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function twoHomes(): { claude: string; opencode: string } {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const claude = tmp("sb-cap-c-");
  const opencode = tmp("sb-cap-o-");
  mkdirSync(join(claude, "config"), { recursive: true });
  mkdirSync(join(opencode, "config"), { recursive: true });
  const appsDir = tmp("sb-cap-apps-");
  writeFileSync(join(appsDir, "apps.json"), JSON.stringify({
    claude: { id: "claude", label: "claude", home: { candidates: [claude] } },
    opencode: { id: "opencode", label: "opencode", home: { candidates: [opencode] } },
  }));
  process.env.HUB_APPS_FILE = join(appsDir, "apps.json");
  process.env.HUB_CONFIG_DIR = opencode;
  return { claude, opencode };
}

describe("the cross-app-sync capability", () => {
  it("reports the files it moved and the homes it moved them between", async () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));

    const result = await crossAppSync().sync();

    expect(result.files).toEqual(["config/settings.json"]);
    expect(result.homes.sort()).toEqual([claude, opencode].sort());
    expect(JSON.parse(readFileSync(join(opencode, "config", "settings.json"), "utf8"))).toEqual({ logConsole: true });
  });

  // The capability and the completion activity are computed from one function on purpose, so a
  // host and the activity log can never describe the same pass differently.
  it("reports exactly what the completion activity recorded", async () => {
    const { claude, opencode } = twoHomes();
    writeFileSync(join(claude, "config", "settings.json"), JSON.stringify({ logConsole: true }));

    const result = await crossAppSync().sync();

    const { records } = readActivity([claude, opencode], { topics: ["sync.completed"] });
    const done = records.find((record) => record.action === "sync_completed");
    expect(done!.details.files).toEqual(result.files);
    expect(done!.details.plugins).toEqual(result.plugins);
  });
});

describe("the entry module's default export", () => {
  it("provides exactly what the manifest declares", async () => {
    const { opencode } = twoHomes();
    const provided: string[] = [];
    const plugin = (await import("../index.js")).default;
    await plugin.activate({
      paths: { home: opencode },
      // The engine mints a typed key from an id alone, which is all the plugin needs from it here.
      capability: (id: string) => ({ id }),
      provide: (key: string | { id: string }) => { provided.push(typeof key === "string" ? key : key.id); },
    } as never);
    const manifest = JSON.parse(readFileSync(new URL("../../plugin.json", import.meta.url), "utf8"));
    expect(provided.slice().sort()).toEqual(manifest.capabilities.slice().sort());
  });

  // The whole point of activating is that the engine stops reading basekit's registry: it reconciles
  // the homes the CONTEXT names. Registering a different pair in apps.json is what makes the
  // assertion decisive rather than accidentally true.
  it("reconciles the homes its context names, not the ones the registry holds", async () => {
    twoHomes();
    const first = tmp("sb-ctx-a-");
    const second = tmp("sb-ctx-b-");
    mkdirSync(join(first, "config"), { recursive: true });
    mkdirSync(join(second, "config"), { recursive: true });
    writeFileSync(join(first, "config", "settings.json"), JSON.stringify({ logConsole: true }));

    const capabilities = new Map<string, { sync(): Promise<{ homes: string[] }> }>();
    const plugin = (await import("../index.js")).default;
    await plugin.activate({
      paths: { home: first },
      capability: (id: string) => ({ id }),
      provide: (key: { id: string }, implementation: never) => { capabilities.set(key.id, implementation); },
      homes: () => [first, second].map((home) => ({ app: home, label: home, present: true, paths: { home } })),
      log: { info: () => {}, error: () => {} },
      events: { publish: () => {} },
      topic: (id: string) => ({ id }),
    } as never);

    const result = await capabilities.get("cross-app-sync")!.sync();

    expect(result.homes.sort()).toEqual([first, second].sort());
    expect(JSON.parse(readFileSync(join(second, "config", "settings.json"), "utf8"))).toEqual({ logConsole: true });
  });
});
