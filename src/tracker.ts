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
      const message = err instanceof Error ? err.message : String(err);
      const prev = this.data.get(p.id);
      // Keep the last good reading and just flag the failure, so a transient
      // refresh error doesn't blank fields (e.g. planLabel, credits, the
      // monthlyMatchesBillingCycle flag) that were fine a moment ago.
      this.data.set(
        p.id,
        prev
          ? { ...prev, status: "error", error: message, updatedAt: Date.now() }
          : {
              id: p.id,
              label: p.label,
              icon: p.icon,
              unit: "tokens",
              status: "error",
              agents: [],
              monthlyTokens: 0,
              error: message,
              updatedAt: Date.now(),
            }
      );
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
