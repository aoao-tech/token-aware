import * as vscode from "vscode";
import { Provider, ProviderData } from "./provider";

export type ProviderMap = Map<string, ProviderData>;

export class Tracker implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ProviderMap>();
  readonly onDidUpdate = this.emitter.event;

  private providers: Provider[] = [];
  private readonly data: ProviderMap = new Map();
  private timer: NodeJS.Timeout | undefined;
  private instantRefresh = true;

  get state(): ProviderMap {
    return this.data;
  }

  setProviders(providers: Provider[]): void {
    for (const p of this.providers) {
      p.dispose();
    }
    this.providers = providers;
    // Drop data for providers no longer present.
    for (const id of [...this.data.keys()]) {
      if (!providers.some((p) => p.id === id)) {
        this.data.delete(id);
      }
    }
  }

  start(intervalSeconds: number, instantRefresh: boolean): void {
    this.stopTimer();
    this.instantRefresh = instantRefresh;
    for (const p of this.providers) {
      p.stopWatch();
      if (instantRefresh) {
        p.startWatch(() => void this.refreshProvider(p));
      }
    }
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), Math.max(5, intervalSeconds) * 1000);
  }

  restart(intervalSeconds: number, instantRefresh: boolean): void {
    this.start(intervalSeconds, instantRefresh);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async refreshAll(): Promise<void> {
    await Promise.all(this.providers.map((p) => this.refreshProvider(p)));
  }

  private async refreshProvider(p: Provider): Promise<void> {
    try {
      this.data.set(p.id, await p.refresh());
    } catch (err) {
      const prev = this.data.get(p.id);
      this.data.set(p.id, {
        id: p.id,
        label: p.label,
        icon: p.icon,
        unit: prev?.unit ?? "tokens",
        status: "error",
        currentAgent: prev?.currentAgent,
        agents: prev?.agents ?? [],
        lastCall: prev?.lastCall,
        monthlyTokens: prev?.monthlyTokens ?? 0,
        monthlyCacheTokens: prev?.monthlyCacheTokens,
        monthlyCostCents: prev?.monthlyCostCents,
        limits: prev?.limits,
        quotaPct: prev?.quotaPct,
        error: err instanceof Error ? err.message : String(err),
        updatedAt: Date.now(),
      });
    }
    this.emitter.fire(this.data);
  }

  dispose(): void {
    this.stopTimer();
    for (const p of this.providers) {
      p.dispose();
    }
    this.emitter.dispose();
  }
}
