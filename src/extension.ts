import * as fs from "node:fs";
import * as vscode from "vscode";
import { getStateDbPath } from "./auth";
import { ClaudeProvider, claudeDataDir } from "./claudeProvider";
import { getConfig, onConfigChange, ToggleSetting, TrackerConfig } from "./config";
import { CursorProvider } from "./cursorProvider";
import { DetailsPanel } from "./panel/panel";
import { Provider } from "./provider";
import { StatusBar } from "./statusBar";
import { Tracker } from "./tracker";

function shouldTrack(setting: ToggleSetting, detected: boolean): boolean {
  return setting === "on" || (setting === "auto" && detected);
}

/** Only build providers for tools that exist on this machine (unless forced). */
function buildProviders(config: TrackerConfig, storageDir: string | undefined): Provider[] {
  const providers: Provider[] = [];
  if (shouldTrack(config.cursorEnabled, getStateDbPath() !== undefined)) {
    providers.push(new CursorProvider());
  }
  if (shouldTrack(config.claudeEnabled, fs.existsSync(claudeDataDir()))) {
    providers.push(new ClaudeProvider(storageDir));
  }
  return providers;
}

export function activate(context: vscode.ExtensionContext): void {
  const tracker = new Tracker();
  const statusBar = new StatusBar();
  let config = getConfig();
  // Shared across every window, since the plan-limit endpoint rate-limits per
  // account rather than per window.
  const storageDir = context.globalStorageUri?.fsPath;

  tracker.setProviders(buildProviders(config, storageDir));

  context.subscriptions.push(
    tracker.onDidUpdate((map) => {
      statusBar.render(map, config);
      DetailsPanel.refreshIfOpen(map);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tokenAware.refresh", () => tracker.refreshAll()),
    vscode.commands.registerCommand("tokenAware.showDetails", () =>
      DetailsPanel.show(() => tracker.state)
    )
  );

  context.subscriptions.push(
    onConfigChange(() => {
      config = getConfig();
      tracker.setProviders(buildProviders(config, storageDir));
      tracker.restart(config.pollIntervalSeconds, config.instantRefreshOnTurn);
    })
  );

  context.subscriptions.push(tracker, statusBar);

  tracker.start(config.pollIntervalSeconds, config.instantRefreshOnTurn);
}

export function deactivate(): void {
  // Disposal handled via context.subscriptions.
}
