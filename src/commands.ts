// @ts-nocheck
// The CLI actions behind this plugin's slash commands, which the manifest declares and a host
// deploys. They shell back into the deployed hook bundle (`node <bundle> <action>`), so maybeRunCli
// runs the action and the process exits before the plugin loads.
import { syncAll } from "./run.js";

// Run a full sync immediately: the broadened default set plus the plugins.json mirror.
function runSyncAction(): void {
  try {
    console.log(JSON.stringify(syncAll(), null, 2));
  } catch (e) {
    console.log(`sync error: ${e?.message || e}`);
  }
}

export async function maybeRunCli(): Promise<boolean> {
  const argv = process.argv.slice(2);
  if (argv[0] === "sync") {
    runSyncAction();
    return true;
  }
  return false;
}
