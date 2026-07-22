import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { aggregateModels, extractText, groupAgents, truncate } from "./agents";
import { ClaudeLimitsResult, fetchClaudeLimits } from "./claudeLimits";
import { ClaudePlan, detectClaudePlan } from "./claudePlan";
import { claudeCostCents } from "./claudePricing";
import { AgentScope, getConfig, UnitSetting } from "./config";
import { LimitsStore } from "./limitsStore";
import { CreditSpend, PlanLimit, Provider, ProviderData, ProviderUnit } from "./provider";
import { ModelAggregate, UsageEvent } from "./types";
import { freshTokens } from "./util";
import { JsonlWatcher } from "./watcher";

/** Per-session facts learned while parsing its transcript. */
interface SessionMeta {
  cwd?: string;
  title?: string;
  /** True for subagent (sidechain) transcripts, which aren't user sessions. */
  sidechain: boolean;
}

interface FileCacheEntry extends SessionMeta {
  mtimeMs: number;
  size: number;
  events: UsageEvent[];
}

export function claudeDataDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/** How long a good plan-limit reading is reused. These percentages move over hours. */
const LIMITS_TTL_MS = 10 * 60_000;
/** How long to wait after a failure the server didn't put a time on. */
const RETRY_MS = 5 * 60_000;

export class ClaudeProvider implements Provider {
  readonly id = "claude";
  readonly label = "Claude";
  readonly icon = "sparkle";

  private watcher: JsonlWatcher | undefined;
  private currentId: string | undefined;
  private plan: ClaudePlan | undefined;
  private planChecked = false;
  /** Last successful reading, kept so a failed lookup doesn't blank the gauges. */
  private lastGoodLimits: PlanLimit[] | undefined;
  /** Kept for the same reason, and separately: credit spend is real money. */
  private lastGoodCredits: CreditSpend | undefined;
  private readonly limitsStore: LimitsStore;

  constructor(storageDir?: string) {
    this.limitsStore = new LimitsStore(storageDir);
  }
  private readonly fileCache = new Map<string, FileCacheEntry>();
  private readonly sessionMeta = new Map<string, SessionMeta>();

  startWatch(onActivity: () => void): void {
    this.stopWatch();
    this.watcher = new JsonlWatcher(claudeDataDir(), (rel) => {
      const base = rel.split(/[/\\]/).pop() ?? "";
      const sessionId = base.replace(/\.jsonl$/, "");
      if (sessionId) {
        this.currentId = sessionId;
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
    const config = getConfig();
    const unit = this.resolveUnit(config.claudeUnit);
    const base: ProviderData = {
      id: this.id,
      label: this.label,
      icon: this.icon,
      unit,
      planLabel: this.plan?.label,
      // Claude's plan limits reset on rolling 5h/7-day windows, not the
      // calendar month, so a calendar-month total belongs in the details
      // view, not the compact status bar.
      monthlyMatchesBillingCycle: false,
      status: "ok",
      agents: [],
      monthlyTokens: 0,
      updatedAt: Date.now(),
    };

    if (!fs.existsSync(claudeDataDir())) {
      return { ...base, status: "no-auth", error: "No Claude Code data found (~/.claude/projects)." };
    }

    const events = this.collectEvents(startOfMonthMs());
    if (events.length === 0) {
      return base;
    }

    // Monthly totals count everything, including subagents and background runs.
    let monthlyTokens = 0;
    let monthlyCacheTokens = 0;
    let monthlySetupTokens = 0;
    let monthlyCostCents = 0;
    for (const e of events) {
      monthlyTokens += freshTokens(e);
      monthlyCacheTokens += e.cacheReadTokens;
      monthlySetupTokens += e.cacheWriteTokens;
      monthlyCostCents += e.costCents ?? 0;
    }

    // The per-session list only shows real, in-scope user sessions.
    const inScope = this.scopePredicate(config.claudeAgentScope);
    const scoped = events.filter((e) => inScope(e.conversationId));
    const currentId =
      this.currentId && inScope(this.currentId)
        ? this.currentId
        : [...scoped].reverse().find((e) => e.conversationId)?.conversationId;

    const agents = groupAgents(scoped, currentId);
    for (const a of agents) {
      a.title = this.titleFor(a.conversationId);
    }
    let currentAgent = agents.find((a) => a.isCurrent);
    if (!currentAgent && currentId) {
      currentAgent = {
        conversationId: currentId,
        title: this.titleFor(currentId),
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

    const { limits, credits, error: limitsError } = await this.getLimits();
    const currentSessionModels: ModelAggregate[] | undefined = currentId
      ? aggregateModels(scoped.filter((e) => e.conversationId === currentId))
      : undefined;

    return {
      ...base,
      currentAgent,
      agents,
      lastCall: lastTurnEvent(scoped.length ? scoped : events),
      contextTokens: conversationSize(scoped.length ? scoped : events),
      monthlyTokens,
      monthlyCacheTokens,
      monthlySetupTokens,
      monthlyCostCents,
      models: aggregateModels(events),
      currentSessionModels,
      limits,
      credits,
      limitsError,
      quotaPct: limits?.length ? Math.max(...limits.map((l) => l.pct)) : undefined,
    };
  }

  /**
   * Plan-limit gauges. The usage endpoint tolerates only a few calls before
   * rate-limiting for five minutes, and these percentages move over hours,
   * so this asks rarely and reuses the answer. Refreshing every poll bought
   * nothing and cost the gauges entirely.
   */
  private async getLimits(): Promise<ClaudeLimitsResult> {
    const now = Date.now();
    const shared = this.limitsStore.read();
    if (shared?.limits.length) {
      this.lastGoodLimits = shared.limits;
      this.lastGoodCredits = shared.credits;
    }

    const waiting = shared?.retryUntil != null && now < shared.retryUntil;
    if (shared && (waiting || now - shared.at < LIMITS_TTL_MS)) {
      return shared.limits.length
        ? { limits: shared.limits, credits: shared.credits }
        : { error: "usage lookup rate-limited" };
    }

    const result = await fetchClaudeLimits();
    if (result.limits?.length) {
      this.lastGoodLimits = result.limits;
      // A successful reading is authoritative about credits too, including
      // saying there are none: turning credits off should take the line away.
      this.lastGoodCredits = result.credits;
      this.limitsStore.write({ at: now, limits: result.limits, credits: result.credits });
      return result;
    }

    // A lookup failing doesn't mean the numbers changed. Keep showing the last
    // good reading rather than making the gauges disappear and look like they
    // were never real. Credit spend is carried through the same way: the
    // endpoint rate-limits within minutes, so dropping it on every failed call
    // would blink the one figure that is actual money in and out of view.
    const keep = this.lastGoodLimits ?? shared?.limits;
    const keepCredits = this.lastGoodCredits ?? shared?.credits;
    if (keep?.length) {
      result.limits = keep;
      result.credits = result.credits ?? keepCredits;
      if (result.retryAfterMs) {
        // Being asked to wait is routine and the numbers are still good, so
        // there is nothing here worth warning about.
        result.error = undefined;
      }
    }
    // Record the wait so other windows don't each go and earn their own 429.
    this.limitsStore.write({
      at: shared?.at ?? 0,
      limits: keep ?? [],
      credits: keepCredits,
      retryUntil: now + (result.retryAfterMs ?? RETRY_MS),
    });
    return result;
  }

  /** "auto" resolves from the local login's billing type; tokens when unknown. */
  private resolveUnit(setting: UnitSetting): ProviderUnit {
    if (!this.planChecked) {
      this.plan = detectClaudePlan();
      this.planChecked = true;
    }
    if (setting !== "auto") {
      return setting;
    }
    return this.plan?.unit ?? "tokens";
  }

  /**
   * Sidechains (subagent transcripts) are never listed as sessions. In
   * "workspace" scope, sessions started from other folders are hidden too.
   */
  private scopePredicate(scope: AgentScope): (id: string | undefined) => boolean {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => normalizePath(f.uri.fsPath));
    const useRoots = scope === "workspace" && roots.length > 0;
    return (id) => {
      if (!id) {
        return false;
      }
      const meta = this.sessionMeta.get(id);
      if (meta?.sidechain) {
        return false;
      }
      if (!useRoots) {
        return true;
      }
      return !!meta?.cwd && roots.some((r) => isWithin(r, meta.cwd as string));
    };
  }

  /** Collect deduped usage events (this month) across all session files. */
  private collectEvents(sinceMs: number): UsageEvent[] {
    let projectDirs: string[];
    try {
      projectDirs = fs.readdirSync(claudeDataDir());
    } catch {
      return [];
    }

    const all: UsageEvent[] = [];
    for (const project of projectDirs) {
      const dir = path.join(claudeDataDir(), project);
      let files: string[];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const file of files) {
        const full = path.join(dir, file);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.mtimeMs < sinceMs) {
          continue; // no activity this month
        }
        const entry = this.parseFile(full, stat);
        this.sessionMeta.set(file.replace(/\.jsonl$/, ""), entry);
        for (const e of entry.events) {
          if (e.timestamp >= sinceMs) {
            all.push(e);
          }
        }
      }
    }
    all.sort((a, b) => a.timestamp - b.timestamp);
    return all;
  }

  private parseFile(full: string, stat: fs.Stats): FileCacheEntry {
    const cached = this.fileCache.get(full);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached;
    }

    const sessionId = path.basename(full).replace(/\.jsonl$/, "");
    const byRequest = new Map<string, UsageEvent>();
    let cwd: string | undefined;
    let summaryTitle: string | undefined;
    let lastUserText: string | undefined;
    let sidechain = false;
    // Counts real user messages, so several tool-call round trips within one
    // reply to the user share a turn number ("cost of my last message").
    let turn = 0;

    let content = "";
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      return { mtimeMs: stat.mtimeMs, size: stat.size, events: [], sidechain: false };
    }

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      // Session titles: Claude Code writes them as "summary" entries.
      if (trimmed.includes('"type":"summary"')) {
        const obj = tryParse(trimmed);
        if (obj?.type === "summary" && typeof obj.summary === "string" && obj.summary) {
          summaryTitle = obj.summary;
        }
        continue;
      }
      // Fallback title: the most recent real user message (skip tool results/meta),
      // which represents what the session is currently about far better than the
      // first message, since sessions often open with a long task-priming brief.
      if (trimmed.includes('"type":"user"') && !trimmed.includes('"toolUseResult"')) {
        const obj = tryParse(trimmed);
        if (obj && obj.type === "user" && obj.isMeta !== true) {
          if (obj.isSidechain === true) {
            sidechain = true;
          } else {
            turn++;
          }
          if (!cwd && typeof obj.cwd === "string") {
            cwd = obj.cwd;
          }
          const message = obj.message as Record<string, unknown> | undefined;
          const text = extractText(message?.content)?.replace(/\s+/g, " ").trim();
          if (text && !text.startsWith("<")) {
            lastUserText = text;
          }
        }
        continue;
      }
      if (trimmed.indexOf('"assistant"') === -1) {
        continue;
      }
      const obj = tryParse(trimmed);
      if (!obj || obj.type !== "assistant") {
        continue;
      }
      if (obj.isSidechain === true) {
        sidechain = true;
      }
      if (!cwd && typeof obj.cwd === "string") {
        cwd = obj.cwd;
      }
      const msg = (obj.message ?? {}) as Record<string, unknown>;
      const usage = msg.usage as Record<string, unknown> | undefined;
      if (!usage) {
        continue;
      }
      const input = num(usage.input_tokens);
      const output = num(usage.output_tokens);
      const cacheRead = num(usage.cache_read_input_tokens);
      const cacheWrite = num(usage.cache_creation_input_tokens);
      // A 1-hour cache write costs 2x base input against a 5-minute write's
      // 1.25x, and Claude Code uses the 1-hour cache in normal operation, so
      // the split is worth carrying rather than averaging away.
      const cc = usage.cache_creation as Record<string, unknown> | undefined;
      const cacheWrite5m = cc ? num(cc.ephemeral_5m_input_tokens) : undefined;
      const cacheWrite1h = cc ? num(cc.ephemeral_1h_input_tokens) : undefined;
      const total = input + output + cacheRead + cacheWrite;
      if (total === 0) {
        continue;
      }
      const model = msg.model as string | undefined;
      const key = (obj.requestId as string) ?? (obj.uuid as string) ?? `${byRequest.size}`;
      const at = Date.parse((obj.timestamp as string) ?? "") || 0;
      // Prices are read as of the call's own timestamp, so a month spanning a
      // price change (Sonnet 5's introductory rate ends 2026-08-31) stays
      // correct instead of being repriced wholesale at today's rate.
      const priceAt = at || Date.now();
      // Last write per request wins (final streamed usage).
      byRequest.set(key, {
        timestamp: at,
        model,
        conversationId: sessionId,
        turn,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalTokens: total,
        costCents: claudeCostCents(
          model,
          { input, output, cacheRead, cacheWrite, cacheWrite5m, cacheWrite1h },
          priceAt
        ),
        setupCostCents: claudeCostCents(
          model,
          { input: 0, output: 0, cacheRead: 0, cacheWrite, cacheWrite5m, cacheWrite1h },
          priceAt
        ),
        reusedCostCents: claudeCostCents(
          model,
          { input: 0, output: 0, cacheRead, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
          priceAt
        ),
      });
    }

    const entry: FileCacheEntry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      events: [...byRequest.values()],
      cwd,
      title: summaryTitle ?? lastUserText,
      sidechain,
    };
    this.fileCache.set(full, entry);
    return entry;
  }

  private titleFor(sessionId: string): string {
    const meta = this.sessionMeta.get(sessionId);
    if (meta?.title) {
      return truncate(meta.title, 48);
    }
    const short = sessionId.slice(0, 8);
    return meta?.cwd ? `${path.basename(meta.cwd)} · ${short}` : short;
  }

  dispose(): void {
    this.stopWatch();
  }
}

/**
 * "Last call" as the cost of your last message, not one internal API request.
 * A single reply is often several tool-call round trips; this sums every
 * event sharing the most recent event's (conversation, turn) pair, since
 * that's what a per-usage-billed user actually wants to know they spent.
 */
/**
 * How big the conversation has become, from the prompt of its most recent
 * single call: everything resent that time. Deliberately not the turn total,
 * which sums several calls that each resend the same conversation and would
 * report a size far larger than the conversation actually is.
 */
function conversationSize(events: UsageEvent[]): number | undefined {
  const last = events.at(-1);
  if (!last) {
    return undefined;
  }
  return last.inputTokens + last.cacheReadTokens + last.cacheWriteTokens;
}

function lastTurnEvent(events: UsageEvent[]): UsageEvent | undefined {
  const last = events.at(-1);
  if (!last || last.turn == null || !last.conversationId) {
    return last;
  }
  const turnEvents = events.filter((e) => e.conversationId === last.conversationId && e.turn === last.turn);
  if (turnEvents.length <= 1) {
    return last;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costCents = 0;
  let setupCostCents = 0;
  let reusedCostCents = 0;
  for (const e of turnEvents) {
    inputTokens += e.inputTokens;
    outputTokens += e.outputTokens;
    cacheReadTokens += e.cacheReadTokens;
    cacheWriteTokens += e.cacheWriteTokens;
    costCents += e.costCents ?? 0;
    setupCostCents += e.setupCostCents ?? 0;
    reusedCostCents += e.reusedCostCents ?? 0;
  }
  return {
    timestamp: last.timestamp,
    model: last.model,
    conversationId: last.conversationId,
    turn: last.turn,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costCents,
    setupCostCents,
    reusedCostCents,
  };
}

function tryParse(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function startOfMonthMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(root: string, child: string): boolean {
  const c = normalizePath(child);
  return c === root || c.startsWith(root + path.sep);
}
