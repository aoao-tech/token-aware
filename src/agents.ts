import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentSpend, ModelAggregate, UsageEvent } from "./types";
import { freshTokens } from "./util";

/**
 * Group usage events by conversation (agent) and mark the current one.
 * Sorted by most-recent activity first.
 */
export function groupAgents(events: UsageEvent[], currentId: string | undefined): AgentSpend[] {
  const map = new Map<string, AgentSpend>();
  for (const e of events) {
    const id = e.conversationId;
    if (!id) {
      continue;
    }
    let a = map.get(id);
    if (!a) {
      a = { conversationId: id, tokens: 0, cacheTokens: 0, costCents: 0, lastTs: 0, count: 0, isCurrent: false };
      map.set(id, a);
    }
    a.tokens += freshTokens(e);
    a.cacheTokens += e.cacheReadTokens;
    a.costCents += e.costCents ?? 0;
    a.lastTs = Math.max(a.lastTs, e.timestamp);
    a.count += 1;
  }
  const list = [...map.values()].sort((x, y) => y.lastTs - x.lastTs);
  for (const a of list) {
    a.isCurrent = a.conversationId === currentId;
  }
  return list;
}

/** Aggregate usage events by model. Pass a pre-filtered slice to scope it to one session. */
export function aggregateModels(events: UsageEvent[]): ModelAggregate[] {
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

/**
 * Resolves a short, friendly title for a conversation by reading the first user
 * message from its transcript file. Results are cached in-memory.
 */
export class TitleResolver {
  private cache = new Map<string, string | undefined>();

  resolve(conversationId: string): string | undefined {
    if (this.cache.has(conversationId)) {
      return this.cache.get(conversationId);
    }
    const title = this.readTitle(conversationId);
    this.cache.set(conversationId, title);
    return title;
  }

  private readTitle(conversationId: string): string | undefined {
    const projectsDir = path.join(os.homedir(), ".cursor", "projects");
    let projects: string[];
    try {
      projects = fs.readdirSync(projectsDir);
    } catch {
      return undefined;
    }
    for (const slug of projects) {
      const file = path.join(
        projectsDir,
        slug,
        "agent-transcripts",
        conversationId,
        `${conversationId}.jsonl`
      );
      if (!fs.existsSync(file)) {
        continue;
      }
      try {
        const head = fs.readFileSync(file, "utf8").split("\n").slice(0, 10);
        for (const line of head) {
          if (!line.trim()) {
            continue;
          }
          const obj = JSON.parse(line) as Record<string, unknown>;
          const role = obj.role ?? obj.type;
          if (role !== "user") {
            continue;
          }
          const text = extractText(obj.message ?? obj.content ?? obj.text);
          if (text) {
            return truncate(text.replace(/\s+/g, " ").trim(), 48);
          }
        }
      } catch {
        return undefined;
      }
      return undefined;
    }
    return undefined;
  }
}

export function extractText(v: unknown): string | undefined {
  if (typeof v === "string") {
    return v;
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = extractText(item);
      if (t) {
        return t;
      }
    }
    return undefined;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return extractText(o.text ?? o.content ?? o.value);
  }
  return undefined;
}

/** Truncate to `n` chars, backing up to the last word boundary so titles don't cut mid-word. */
export function truncate(s: string, n: number): string {
  if (s.length <= n) {
    return s;
  }
  const cut = s.slice(0, n - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const boundary = lastSpace > n * 0.6 ? lastSpace : cut.length;
  return `${cut.slice(0, boundary)}\u2026`;
}

export function shortId(conversationId: string): string {
  return conversationId.slice(0, 8);
}
