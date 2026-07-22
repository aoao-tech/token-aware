import * as os from "node:os";
import * as path from "node:path";
import { aggregateModels, groupAgents, TitleResolver } from "./agents";
import { getCredentials, getStateDbPath } from "./auth";
import { getConfig, UnitSetting } from "./config";
import { CursorApiClient } from "./cursorApi";
import { Provider, ProviderData, ProviderUnit } from "./provider";
import { AgentSpend, UsageSnapshot } from "./types";
import { titleCase } from "./util";
import { JsonlWatcher } from "./watcher";

export class CursorProvider implements Provider {
  readonly id = "cursor";
  readonly label = "Cursor";
  readonly icon = "zap";

  private readonly titles = new TitleResolver();
  private watcher: JsonlWatcher | undefined;
  private currentId: string | undefined;
  private detectedUnit: ProviderUnit | undefined;
  private planLabel: string | undefined;

  startWatch(onActivity: () => void): void {
    this.stopWatch();
    const dir = path.join(os.homedir(), ".cursor", "projects");
    this.watcher = new JsonlWatcher(dir, (rel) => {
      const m = rel.match(/agent-transcripts[/\\]([^/\\]+)[/\\]/);
      if (m) {
        this.currentId = m[1];
      }
      onActivity();
    });
    this.watcher.start();
  }

  stopWatch(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  async refresh(): Promise<ProviderData> {
    const setting = getConfig().cursorUnit;
    const base = this.emptyData(setting === "auto" ? this.detectedUnit ?? "dollars" : setting);

    if (!getStateDbPath()) {
      return { ...base, status: "no-auth", error: "Cursor state DB not found (is Cursor installed?)." };
    }
    const creds = await getCredentials();
    if (!creds) {
      return {
        ...base,
        status: "no-auth",
        error:
          "Could not read Cursor auth token. Check that Cursor is signed in and the `sqlite3` CLI is installed.",
      };
    }

    const client = new CursorApiClient(creds);
    const snapshot = await client.fetchSnapshot();
    const unit = this.resolveUnit(setting, snapshot);
    if (snapshot.membershipType) {
      this.planLabel = titleCase(snapshot.membershipType);
    }

    const newest = [...snapshot.events].reverse().find((e) => e.conversationId);
    const currentId = this.currentId ?? newest?.conversationId;

    const agents = groupAgents(snapshot.events, currentId);
    for (const a of agents) {
      a.title = this.titles.resolve(a.conversationId);
    }
    let currentAgent = agents.find((a) => a.isCurrent);
    if (!currentAgent && currentId) {
      currentAgent = zeroAgent(currentId, this.titles.resolve(currentId));
    }

    return {
      ...base,
      unit,
      planLabel: this.planLabel,
      status: "ok",
      currentAgent,
      agents,
      lastCall: snapshot.events.at(-1),
      monthlyTokens: snapshot.inputTokens + snapshot.outputTokens + snapshot.cacheWriteTokens,
      monthlyCacheTokens: snapshot.cacheReadTokens,
      monthlySetupTokens: snapshot.cacheWriteTokens,
      monthlyCostCents: snapshot.monthlyCostCents,
      models: snapshot.models,
      currentSessionModels: currentId
        ? aggregateModels(snapshot.events.filter((e) => e.conversationId === currentId))
        : undefined,
      quotaPct: snapshot.quotaPct,
    };
  }

  /**
   * "auto": org plans (enterprise/business/team) typically bill per usage ->
   * dollars; individual plans are flat monthly -> tokens. When the plan is
   * unreported, fall back to whether the dashboard shows spend this month.
   */
  private resolveUnit(setting: UnitSetting, snapshot: UsageSnapshot): ProviderUnit {
    if (setting !== "auto") {
      return setting;
    }
    const plan = snapshot.membershipType;
    let unit: ProviderUnit;
    if (plan) {
      unit = /enterprise|business|team/.test(plan) ? "dollars" : "tokens";
    } else {
      unit = snapshot.monthlyCostCents ? "dollars" : "tokens";
    }
    this.detectedUnit = unit;
    return unit;
  }

  private emptyData(unit: ProviderData["unit"]): ProviderData {
    return {
      id: this.id,
      label: this.label,
      icon: this.icon,
      unit,
      status: "ok",
      agents: [],
      monthlyTokens: 0,
      updatedAt: Date.now(),
    };
  }

  dispose(): void {
    this.stopWatch();
  }
}

function zeroAgent(conversationId: string, title: string | undefined): AgentSpend {
  return {
    conversationId,
    title,
    tokens: 0,
    setupTokens: 0,
    cacheTokens: 0,
    costCents: 0,
    setupCostCents: 0,
    reusedCostCents: 0,
    lastTs: 0,
    count: 0,
    isCurrent: true,
  };
}
