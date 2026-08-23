import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readActivity } from "@intisy-ai/core";
import { crossAppSync } from "../plugin.js";

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
      provide: (key: string | { id: string }) => { provided.push(typeof key === "string" ? key : key.id); },
    } as never);
    const manifest = JSON.parse(readFileSync(new URL("../../plugin.json", import.meta.url), "utf8"));
    expect(provided.slice().sort()).toEqual(manifest.capabilities.slice().sort());
  });
});
