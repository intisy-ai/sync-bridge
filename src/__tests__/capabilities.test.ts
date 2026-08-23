import { describe, it, expect } from "vitest";
import { resolveLayout } from "@intisy-ai/core";
import { SYNC_BRIDGE_SETTINGS } from "../config.js";

describe("the settings section sync-bridge contributes", () => {
  const layout = resolveLayout("sync-bridge", SYNC_BRIDGE_SETTINGS);

  it("offers the master switch, every category, and the run action in one section", () => {
    expect(layout.sections).toHaveLength(1);
    const [section] = layout.sections;
    expect(section).toMatchObject({ id: "sync", label: "Sync", scope: "allHomes", plugin: "sync-bridge" });
    expect(section.fields.map((f) => f.key)).toEqual([
      "enabled",
      "categories.accounts",
      "categories.plugins",
      "categories.settings",
      "categories.pluginConfigs",
    ]);
    expect(section.actions.map((a) => a.id)).toEqual(["sync"]);
  });

  it("leaves the operational settings as the plugin's own, out of the contributed section", () => {
    expect(layout.fields.map((f) => f.key)).toEqual([
      "logging",
      "sync_plugins",
      "default_strategy",
      "debounce_seconds",
      "exclude",
      "files",
    ]);
  });

  it("names an action the bundle actually answers to", () => {
    expect(SYNC_BRIDGE_SETTINGS.actions?.map((a) => a.id)).toContain("sync");
  });
});
