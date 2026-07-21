import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { extractText, groupAgents, truncate } from "./agents";
import { fetchClaudeLimits } from "./claudeLimits";
import { ClaudePlan, detectClaudePlan } from "./claudePlan";
import { claudeCostCents } from "./claudePricing";
import { AgentScope, getConfig, UnitSetting } from "./config";
import { PlanLimit, Provider, ProviderData, ProviderUnit } from "./provider";
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

export class ClaudeProvider implements Provider {
  readonly id = "claude";
  readonly label = "Claude";
  readonly icon = "sparkle";

  private watcher: JsonlWatcher | undefined;
  private currentId: string | undefined;
  private plan: ClaudePlan | undefined;
  private planChecked = false;
  private limitsCache: { at: number; limits?: PlanLimit[] } | undefined;
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
    let monthlyCostCents = 0;
    for (const e of events) {
      monthlyTokens += freshTokens(e);
      monthlyCacheTokens += e.cacheReadTokens;
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
        cacheTokens: 0,
        costCents: 0,
        lastTs: 0,
        count: 0,
        isCurrent: true,
      };
    }

    const limits = await this.getLimits();

    return {
      ...base,
      currentAgent,
      agents,
      lastCall: scoped.at(-1) ?? events.at(-1),
      monthlyTokens,
      monthlyCacheTokens,
      monthlyCostCents,
      models: aggregateModels(events),
      limits,
      quotaPct: limits?.length ? Math.max(...limits.map((l) => l.pct)) : undefined,
    };
  }

  /** Plan-limit gauges, cached briefly so polling doesn't hammer the endpoint. */
  private async getLimits(): Promise<PlanLimit[] | undefined> {
    const now = Date.now();
    if (this.limitsCache && now - this.limitsCache.at < 60_000) {
      return this.limitsCache.limits;
    }
    const limits = await fetchClaudeLimits();
    this.limitsCache = { at: now, limits };
    return limits;
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
    let firstUserText: string | undefined;
    let sidechain = false;

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
      // Fallback title: the first real user message (skip tool results/meta).
      if (!firstUserText && trimmed.includes('"type":"user"') && !trimmed.includes('"toolUseResult"')) {
        const obj = tryParse(trimmed);
        if (obj && obj.type === "user" && obj.isMeta !== true) {
          if (obj.isSidechain === true) {
            sidechain = true;
          }
          if (!cwd && typeof obj.cwd === "string") {
            cwd = obj.cwd;
          }
          const message = obj.message as Record<string, unknown> | undefined;
          const text = extractText(message?.content)?.replace(/\s+/g, " ").trim();
          if (text && !text.startsWith("<")) {
            firstUserText = text;
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
      const total = input + output + cacheRead + cacheWrite;
      if (total === 0) {
        continue;
      }
      const model = msg.model as string | undefined;
      const key = (obj.requestId as string) ?? (obj.uuid as string) ?? `${byRequest.size}`;
      // Last write per request wins (final streamed usage).
      byRequest.set(key, {
        timestamp: Date.parse((obj.timestamp as string) ?? "") || 0,
        model,
        conversationId: sessionId,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalTokens: total,
        costCents: claudeCostCents(model, { input, output, cacheRead, cacheWrite }),
      });
    }

    const entry: FileCacheEntry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      events: [...byRequest.values()],
      cwd,
      title: summaryTitle ?? firstUserText,
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

function aggregateModels(events: UsageEvent[]): ModelAggregate[] {
  const map = new Map<string, ModelAggregate>();
  for (const e of events) {
    const key = e.model ?? "unknown";
    let m = map.get(key);
    if (!m) {
      m = { model: key, totalTokens: 0, cacheTokens: 0, costCents: 0 };
      map.set(key, m);
    }
    m.totalTokens += freshTokens(e);
    m.cacheTokens = (m.cacheTokens ?? 0) + e.cacheReadTokens;
    m.costCents += e.costCents ?? 0;
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}
