import { CROSS_APP_SYNC } from "@intisy-ai/core";
import type { CrossAppSyncCapability, SyncResult } from "@intisy-ai/core";
import type { Plugin, PluginContext } from "@intisy-ai/api";
import { addedPluginsOf, changedFilesOf, syncAll } from "./run.js";
import { existingHomes } from "./homes.js";

/**
 * This plugin's `cross-app-sync` capability.
 *
 * @remarks
 * This is the one component permitted to span both app homes, so it is the one that may answer
 * this capability. A pass the config has switched off, or one another process already holds the
 * lock for, moved nothing and reports nothing moved: the result says what happened, and a caller
 * asking "did anything change" gets the same truthful answer either way.
 */
export function crossAppSync(): CrossAppSyncCapability {
  return {
    async sync(): Promise<SyncResult> {
      const pass = syncAll();
      return {
        files: changedFilesOf(pass.files),
        plugins: addedPluginsOf(pass.plugins),
        homes: existingHomes(),
      };
    },
  };
}

const plugin: Plugin = {
  activate(context: PluginContext) {
    context.provide(CROSS_APP_SYNC, crossAppSync());
  },
  deactivate() {},
};

export default plugin;
