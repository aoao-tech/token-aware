import { AgentSpend, ModelAggregate, UsageEvent } from "./types";

export type ProviderUnit = "dollars" | "tokens";
export type ProviderStatus = "ok" | "error" | "no-auth" | "disabled";

/** One usage-limit bucket, e.g. the 5-hour session or a weekly cap. */
export interface PlanLimit {
  label: string;
  /** 0..100 percent used. */
  pct: number;
  resetsAt?: number;
  /** Bucket kind, used to pick which limits headline the status bar. */
  kind: "session" | "weekly-all" | "weekly-model" | "other";
}

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
  /** Newly processed tokens this month (input + output + cache writes). */
  monthlyTokens: number;
  /** Cache-read tokens this month, tracked separately. */
  monthlyCacheTokens?: number;
  monthlyCostCents?: number;
  models?: ModelAggregate[];
  /** Plan-limit gauges (session/weekly buckets), when the plan has limits. */
  limits?: PlanLimit[];
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
