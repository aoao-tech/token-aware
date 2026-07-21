import { CursorCredentials } from "./auth";
import { ModelAggregate, UsageEvent, UsageSnapshot } from "./types";

const BASE = "https://cursor.com";

export class CursorApiError extends Error {}

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function startOfMonthMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

interface AggregatedResult {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costCents: number;
  models: ModelAggregate[];
}

export class CursorApiClient {
  constructor(private readonly creds: CursorCredentials) {}

  private async request(pathname: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${BASE}${pathname}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: this.creds.sessionCookie,
        Authorization: `Bearer ${this.creds.token}`,
        // Dashboard POST endpoints enforce a same-origin check.
        Origin: BASE,
        Referer: `${BASE}/dashboard`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new CursorApiError(`${pathname} -> HTTP ${res.status}`);
    }
    const text = await res.text();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new CursorApiError(`${pathname} -> non-JSON response`);
    }
  }

  /** GET /api/usage: premium request counts + limits (may be null for token/business plans). */
  async getUsage(): Promise<{ used?: number; limit?: number } | undefined> {
    try {
      const data = (await this.request(
        `/api/usage?user=${encodeURIComponent(this.creds.userId)}`
      )) as Record<string, unknown>;
      const primary = (data["gpt-4"] ?? data["gpt-4o"]) as Record<string, unknown> | undefined;
      if (!primary) {
        return undefined;
      }
      const limit = toNum(primary.maxRequestUsage);
      return { used: toNum(primary.numRequests), limit: limit > 0 ? limit : undefined };
    } catch {
      return undefined;
    }
  }

  /** GET /api/auth/stripe: account plan ("free", "pro", "enterprise", ...). */
  async getMembershipType(): Promise<string | undefined> {
    try {
      const data = (await this.request("/api/auth/stripe")) as Record<string, unknown>;
      const type = data.membershipType;
      return typeof type === "string" && type ? type.toLowerCase() : undefined;
    } catch {
      return undefined;
    }
  }

  /** POST /api/dashboard/get-aggregated-usage-events: accurate monthly totals + per-model. */
  async getAggregated(startMs: number, endMs: number): Promise<AggregatedResult> {
    const data = (await this.request("/api/dashboard/get-aggregated-usage-events", {
      method: "POST",
      body: JSON.stringify({ teamId: 0, startDate: String(startMs), endDate: String(endMs) }),
    })) as Record<string, unknown>;

    const aggregations = (data.aggregations as unknown[]) ?? [];
    const models: ModelAggregate[] = aggregations.map((raw) => {
      const a = raw as Record<string, unknown>;
      const tokens =
        toNum(a.inputTokens) +
        toNum(a.outputTokens) +
        toNum(a.cacheReadTokens) +
        toNum(a.cacheWriteTokens);
      return {
        model: (a.modelIntent ?? a.model ?? "unknown") as string,
        totalTokens: tokens,
        costCents: toNum(a.totalCents),
      };
    });
    models.sort((x, y) => y.totalTokens - x.totalTokens);

    const inputTokens = toNum(data.totalInputTokens);
    const outputTokens = toNum(data.totalOutputTokens);
    const cacheReadTokens = toNum(data.totalCacheReadTokens);
    const cacheWriteTokens = toNum(data.totalCacheWriteTokens);
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
      costCents: toNum(data.totalCostCents),
      models,
    };
  }

  /** POST /api/dashboard/get-filtered-usage-events: recent per-request token usage (newest first). */
  async getUsageEvents(startMs: number, endMs: number, page = 1, pageSize = 500): Promise<UsageEvent[]> {
    const data = (await this.request("/api/dashboard/get-filtered-usage-events", {
      method: "POST",
      body: JSON.stringify({ teamId: 0, startDate: String(startMs), endDate: String(endMs), page, pageSize }),
    })) as Record<string, unknown>;

    const rawEvents =
      (data.usageEventsDisplay as unknown[]) ??
      (data.usageEvents as unknown[]) ??
      (data.events as unknown[]) ??
      [];

    return rawEvents.map((raw): UsageEvent => {
      const e = raw as Record<string, unknown>;
      const tu = (e.tokenUsage ?? {}) as Record<string, unknown>;
      const inputTokens = toNum(tu.inputTokens ?? e.inputTokens);
      const outputTokens = toNum(tu.outputTokens ?? e.outputTokens);
      const cacheReadTokens = toNum(tu.cacheReadTokens ?? e.cacheReadTokens);
      const cacheWriteTokens = toNum(tu.cacheWriteTokens ?? e.cacheWriteTokens);
      const costCents = toNum(tu.totalCents ?? e.costCents);
      return {
        timestamp: toNum(e.timestamp ?? e.createdAt),
        model: (e.model ?? e.modelIntent) as string | undefined,
        kind: (e.kind ?? e.kindLabel) as string | undefined,
        conversationId: (e.conversationId ?? e.chatId ?? e.composerId) as string | undefined,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
        costCents: costCents > 0 ? costCents : undefined,
      };
    });
  }

  /**
   * Fetch the newest `maxPages` pages of events. Returned sorted oldest -> newest.
   * This window is used to group spend per agent (conversation).
   */
  async getRecentEvents(startMs: number, endMs: number, maxPages = 4): Promise<UsageEvent[]> {
    const collected: UsageEvent[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.getUsageEvents(startMs, endMs, page, 500);
      collected.push(...batch);
      if (batch.length < 500) {
        break;
      }
    }
    collected.sort((a, b) => a.timestamp - b.timestamp);
    return collected;
  }

  /** Build a full snapshot for the current billing period. */
  async fetchSnapshot(): Promise<UsageSnapshot> {
    const now = Date.now();
    const start = startOfMonthMs(now);

    const [agg, usage, events, membershipType] = await Promise.all([
      this.getAggregated(start, now),
      this.getUsage(),
      this.getRecentEvents(start, now).catch(() => [] as UsageEvent[]),
      this.getMembershipType(),
    ]);

    const quotaPct =
      usage?.used != null && usage.limit
        ? Math.min(100, Math.round((usage.used / usage.limit) * 100))
        : undefined;

    return {
      fetchedAt: now,
      totalTokens: agg.totalTokens,
      inputTokens: agg.inputTokens,
      outputTokens: agg.outputTokens,
      cacheReadTokens: agg.cacheReadTokens,
      cacheWriteTokens: agg.cacheWriteTokens,
      monthlyCostCents: agg.costCents > 0 ? agg.costCents : undefined,
      models: agg.models,
      includedRequests: usage?.used,
      includedRequestsLimit: usage?.limit,
      quotaPct,
      membershipType,
      events,
      raw: { usage },
    };
  }
}
