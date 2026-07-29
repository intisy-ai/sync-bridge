// @ts-nocheck
// Cross-app slash-commands for sync-bridge plus the CLI actions behind them.
// The commands shell back into the deployed hook bundle (`node <bundle> <action>`),
// so maybeRunCli runs the action and the process exits before the plugin loads.
import { configCommand, runConfigCli, type CommandDef } from "../core/src/index.js";
import { syncAll } from "./run.js";

export const SYNC_COMMANDS: CommandDef[] = [
  configCommand("sync-bridge"),
  {
    name: "sync",
    description: "Reconcile synced files + mirror sync-enabled plugins across both apps now",
    shell: 'node "{{BUNDLE}}" sync',
    body: "Above is the sync-bridge result (files reconciled + plugins mirrored). Summarize what changed.",
  },
];

// Run a full sync immediately: the broadened default set plus the plugins.json mirror.
function runSyncAction(): void {
  try {
    console.log(JSON.stringify(syncAll(), null, 2));
  } catch (e) {
    console.log(`sync error: ${e?.message || e}`);
  }
}

export async function maybeRunCli(pluginName: string): Promise<boolean> {
  const argv = process.argv.slice(2);
  if (argv[0] === "config") {
    runConfigCli(pluginName, argv.slice(1));
    return true;
  }
  if (argv[0] === "sync") {
    runSyncAction();
    return true;
  }
  return false;
}
