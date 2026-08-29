import type { CrossAppSyncCapability, SettingsCapability, SyncResult } from "@intisy-ai/basekit";
import type { Plugin, PluginContext } from "@intisy-ai/api";
import { addedPluginsOf, changedFilesOf, syncAll } from "./run.js";
import { existingHomes } from "./homes.js";
import { SYNC_BRIDGE_SETTINGS } from "./config.js";
import { setSyncRuntime, type SyncRuntime } from "./runtime.js";

/**
 * The engine's runtime, answered by this plugin's context.
 *
 * @remarks
 * Every home rather than this plugin's own, which is what reconciling across apps means and what
 * `ctx.homes()` exists to answer. An error is logged at error level and anything else at info,
 * because the context's logger separates them where this engine passes a flag.
 */
function contextRuntime(context: PluginContext): SyncRuntime {
  return {
    homes: () => context.homes().map((home) => ({
      home: home.paths.home,
      app: home.app,
      loaderId: home.loader,
      present: home.present,
    })),
    home: () => context.paths.home,
    log: (message, isError) => (isError ? context.log.error(message) : context.log.info(message)),
    emit: ({ topic, ...payload }) => context.events.publish(context.topic(topic), payload),
  };
}

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

/**
 * This plugin's `settings` capability: what its settings are called, and the one action behind them.
 *
 * @remarks
 * The only action is the same full pass the slash command runs, so a surface offering "sync now"
 * and a user typing the command reach identical code.
 */
export function syncBridgeSettings(): SettingsCapability {
  return {
    schema: () => SYNC_BRIDGE_SETTINGS,
    run: async (actionId: string) => {
      if (actionId !== "sync") return { ok: false, message: `unknown action: ${actionId}` };
      const pass = syncAll();
      return { ok: true, message: `${changedFilesOf(pass.files).length} files, ${addedPluginsOf(pass.plugins).length} plugins` };
    },
  };
}

const plugin: Plugin = {
  activate(context: PluginContext) {
    setSyncRuntime(contextRuntime(context));
    context.provide(context.capability<CrossAppSyncCapability>("cross-app-sync"), crossAppSync());
    context.provide(context.capability<SettingsCapability>("settings"), syncBridgeSettings());
  },
  deactivate() {},
};

export default plugin;
