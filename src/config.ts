import * as vscode from "vscode";
import { ProviderUnit } from "./provider";

export type DisplayMode = "session" | "monthly" | "both";

/** A configured unit: fixed, or "auto" to detect from the account's plan. */
export type UnitSetting = ProviderUnit | "auto";

/** Provider toggle: "auto" shows a provider only when its tool is detected. */
export type ToggleSetting = "auto" | "on" | "off";

/** Which Claude sessions to list: current workspace only, or all on disk. */
export type AgentScope = "workspace" | "all";

export interface TrackerConfig {
  pollIntervalSeconds: number;
  displayMode: DisplayMode;
  instantRefreshOnTurn: boolean;
  cursorEnabled: ToggleSetting;
  claudeEnabled: ToggleSetting;
  cursorUnit: UnitSetting;
  claudeUnit: UnitSetting;
  claudeAgentScope: AgentScope;
}

const SECTION = "tokenAware";

export function getConfig(): TrackerConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    pollIntervalSeconds: Math.max(5, c.get<number>("pollIntervalSeconds", 30)),
    displayMode: c.get<DisplayMode>("displayMode", "both"),
    instantRefreshOnTurn: c.get<boolean>("instantRefreshOnTurn", true),
    cursorEnabled: toggle(c.get("cursor.enabled")),
    claudeEnabled: toggle(c.get("claude.enabled")),
    cursorUnit: c.get<UnitSetting>("cursor.unit", "auto"),
    claudeUnit: c.get<UnitSetting>("claude.unit", "auto"),
    claudeAgentScope: c.get<AgentScope>("claude.sessionScope", "workspace"),
  };
}

/** Accepts legacy booleans as well as the "auto" | "on" | "off" strings. */
function toggle(v: unknown): ToggleSetting {
  if (v === false || v === "off") {
    return "off";
  }
  if (v === "on") {
    return "on";
  }
  // Legacy boolean true and anything else fall back to auto-detection.
  return "auto";
}

export function onConfigChange(cb: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      cb();
    }
  });
}
