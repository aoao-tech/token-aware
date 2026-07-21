export interface UsageEvent {
  timestamp: number;
  model?: string;
  kind?: string;
  conversationId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costCents?: number;
  /**
   * Which user turn this call belongs to (increments per real user message
   * in a session). One turn is often several API calls (tool use round
   * trips), so this groups them for a "cost of my last message" total.
   */
  turn?: number;
}

export interface AgentSpend {
  conversationId: string;
  title?: string;
  /** Newly processed tokens: input + output + cache writes. */
  tokens: number;
  /** Context re-served from the prompt cache (cheap, shown separately). */
  cacheTokens: number;
  costCents: number;
  lastTs: number;
  count: number;
  isCurrent: boolean;
}

export interface ModelAggregate {
  model: string;
  /** Newly processed tokens: input + output + cache writes. */
  totalTokens: number;
  cacheTokens?: number;
  costCents: number;
}

export interface UsageSnapshot {
  fetchedAt: number;
  /** Monthly totals (from the aggregated endpoint). */
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Total spend this period, in cents (usage-based + included token fees). */
  monthlyCostCents?: number;
  /** Per-model monthly breakdown. */
  models: ModelAggregate[];
  /** Included premium requests used vs limit, if reported. */
  includedRequests?: number;
  includedRequestsLimit?: number;
  /** 0..100 percentage of included allotment consumed (may be undefined). */
  quotaPct?: number;
  /** Account plan reported by the dashboard, e.g. "pro", "enterprise". */
  membershipType?: string;
  /** Recent per-request events (newest last), used for per-agent + per-turn calc. */
  events: UsageEvent[];
  raw?: unknown;
}
