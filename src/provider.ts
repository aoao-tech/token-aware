import { AgentSpend, ModelAggregate, UsageEvent } from "./types";

export type ProviderUnit = "dollars" | "tokens";
export type ProviderStatus = "ok" | "error" | "no-auth" | "disabled";

/** Normalized data every provider produces, consumed by the shared UI. */
export interface ProviderData {
  id: string;
  label: string;
  /** Codicon id shown in the status bar, e.g. "zap". */
  icon: string;
  unit: ProviderUnit;
  status: ProviderStatus;
  /** Detected billing plan, e.g. "Max", "Enterprise", "API billing". */
  planLabel?: string;
  /** Agent (conversation/session) you most recently interacted with. */
  currentAgent?: AgentSpend;
  /** All agents seen in the fetched window, most recent first. */
  agents: AgentSpend[];
  /** Most recent single call. */
  lastCall?: UsageEvent;
  monthlyTokens: number;
  monthlyCostCents?: number;
  models?: ModelAggregate[];
  quotaPct?: number;
  error?: string;
  updatedAt: number;
}

export interface Provider {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  /** Fetch the latest normalized data. */
  refresh(): Promise<ProviderData>;
  /** Start watching for activity; call onActivity when a turn completes. */
  startWatch(onActivity: () => void): void;
  stopWatch(): void;
  dispose(): void;
}
