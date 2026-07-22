import * as vscode from "vscode";
import { shortId } from "./agents";
import { DisplayMode, TrackerConfig } from "./config";
import { PlanLimit, ProviderData, ProviderUnit } from "./provider";
import { ProviderMap } from "./tracker";
import { AgentSpend } from "./types";
import { answeringCostCents, answeringTokens, formatCents, formatDuration, formatTokens, replyTokens } from "./util";

export class StatusBar implements vscode.Disposable {
  private readonly items = new Map<string, vscode.StatusBarItem>();

  render(map: ProviderMap, config: TrackerConfig): void {
    const datas = [...map.values()];
    // Remove items for providers no longer present.
    for (const id of [...this.items.keys()]) {
      if (!map.has(id)) {
        this.items.get(id)?.dispose();
        this.items.delete(id);
      }
    }
    datas.forEach((data, index) => {
      const item = this.ensureItem(data.id, index);
      this.renderItem(item, data, config.displayMode);
    });
  }

  private ensureItem(id: string, index: number): vscode.StatusBarItem {
    let item = this.items.get(id);
    if (!item) {
      // Left-aligned, low priority => sits at the tail end of the left-hand
      // group, just right of VS Code's built-in Problems (errors/warnings)
      // indicator, which uses a higher priority than this. Higher priority
      // is further left, so earlier providers (lower index) land closer to
      // Problems.
      item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1 - index);
      item.command = "tokenAware.showDetails";
      item.show();
      this.items.set(id, item);
    }
    return item;
  }

  private renderItem(item: vscode.StatusBarItem, data: ProviderData, mode: DisplayMode): void {
    const icon = `$(${data.icon})`;
    if (data.status === "no-auth") {
      item.text = `${icon} ${data.label}: n/a`;
      item.tooltip = new vscode.MarkdownString(`**${data.label}**\n\n${escapeMd(data.error ?? "Unavailable.")}`);
      item.backgroundColor = undefined;
      return;
    }
    if (data.status === "error" && !data.currentAgent && data.monthlyTokens === 0) {
      item.text = `${icon} ${data.label} $(error)`;
      item.tooltip = new vscode.MarkdownString(`**${data.label}**\n\n${escapeMd(data.error ?? "Refresh failed.")}`);
      return;
    }

    const fmtAmount = (costCents: number | undefined, tokens: number): string =>
      data.unit === "dollars" ? formatCents(costCents ?? 0) : formatTokens(tokens);

    // Session and month show the true total, context loading included: over a
    // session that context is genuinely consumed and genuinely billed. Only
    // the last turn strips it out, because there it gets misread as the cost
    // of the message just typed.
    const cur = data.currentAgent;
    const agent = `${fmtAmount(cur?.costCents, cur?.tokens ?? 0)} session`;
    // On per-usage billing the headline is the true total charged, since
    // that's the number being paid; the tooltip and panel say where it went.
    // In tokens mode the headline is the reply instead, because folding in
    // context-loading made a one-word message read as if it used 60k by
    // itself, which looks made up. Setup is shown beside it either way.
    const lc = data.lastCall;
    const last = lc
      ? data.unit === "dollars"
        ? // Per-usage: one figure, the true total charged for the turn. Two
          // dollar amounts side by side just make the reader do arithmetic.
          `${formatCents(lc.costCents ?? 0)} last`
        : // Subscription: the reply, since that's what "my last message used"
          // means to a person. Loading context is real but it isn't something
          // they typed, so it's itemized in the tooltip instead.
          `${formatTokens(replyTokens(lc))} last`
      : undefined;
    const monthly = `${fmtAmount(data.monthlyCostCents, data.monthlyTokens)} mo`;

    const parts: string[] = [];
    if (mode !== "monthly") {
      parts.push(agent);
    }
    if (last) {
      parts.push(last);
    }
    if (mode !== "session" && data.monthlyMatchesBillingCycle !== false) {
      parts.push(monthly);
    }
    // Once past the plan's included usage, spend is real money at API rates.
    // Only shown once it's above zero: a permanent "$0.00 credits" is noise,
    // but the moment it starts costing is exactly what this tool is for.
    if (data.credits && data.credits.usedCents > 0) {
      parts.push(`${formatCents(data.credits.usedCents)} credits`);
    }
    const headline = this.headlineLimits(data);
    if (headline.length) {
      for (const l of headline) {
        parts.push(`${Math.round(l.pct)}% ${l.kind === "session" ? "session" : "week"}`);
      }
    } else if (data.quotaPct != null) {
      // Providers without kind-tagged limit buckets (Cursor) still get a
      // single premium-request quota percentage.
      parts.push(`${Math.round(data.quotaPct)}%`);
    } else if (data.limitsError) {
      // Say the gauges are missing rather than letting them vanish; a silent
      // gap reads as the numbers being wrong, not as a failed lookup.
      parts.push(`$(warning) limits`);
    }
    item.text = `${icon} ${parts.join(" \u00b7 ")}`;
    item.backgroundColor = this.pickBackground(data);
    item.tooltip = this.buildTooltip(data);
  }

  /** Session (5h) and all-models weekly usage; per-model weekly buckets stay tooltip/panel-only. */
  private headlineLimits(data: ProviderData): PlanLimit[] {
    if (!data.limits?.length) {
      return [];
    }
    return data.limits.filter((l) => l.kind === "session" || l.kind === "weekly-all");
  }

  private pickBackground(data: ProviderData): vscode.ThemeColor | undefined {
    const headline = this.headlineLimits(data);
    const candidates = headline.map((l) => l.pct);
    // Nearing the monthly credit cap deserves the same warning as nearing a
    // plan limit: it's the ceiling on real money, not just on throughput.
    if (data.credits?.pct != null && data.credits.usedCents > 0) {
      candidates.push(data.credits.pct);
    }
    const pct = candidates.length ? Math.max(...candidates) : data.quotaPct;
    if (pct == null) {
      return undefined;
    }
    if (pct >= 100) {
      return new vscode.ThemeColor("statusBarItem.errorBackground");
    }
    if (pct >= 90) {
      return new vscode.ThemeColor("statusBarItem.warningBackground");
    }
    return undefined;
  }

  /** Tooltip-safe label: session titles come from transcript content. */
  private label(a: AgentSpend): string {
    return escapeMd(a.title ?? shortId(a.conversationId));
  }

  private amount(unit: ProviderUnit, costCents: number | undefined, tokens: number): string {
    return unit === "dollars" ? formatCents(costCents ?? 0) : formatTokens(tokens);
  }

  private buildTooltip(data: ProviderData): vscode.MarkdownString {
    // Deliberately NOT trusted: interpolated titles come from transcripts.
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${data.label} token usage**\n\n`);
    if (data.planLabel) {
      md.appendMarkdown(`Plan: **${data.planLabel}**\n\n`);
    }

    const cur = data.currentAgent;
    if (cur) {
      md.appendMarkdown(`Current session: **${this.label(cur)}**\n\n`);
      md.appendMarkdown(
        `\u2937 **${this.amount(data.unit, cur.costCents, cur.tokens)}** \u00b7 ${this.amount(
          data.unit,
          Math.max(0, cur.costCents - cur.setupCostCents - cur.reusedCostCents),
          answeringTokens(cur.tokens, cur.setupTokens)
        )} answering + ${this.amount(
          data.unit,
          cur.setupCostCents,
          cur.setupTokens
        )} loading context \u00b7 ${cur.count} calls\n\n`
      );
    }
    const last = data.lastCall;
    if (last) {
      // One headline figure, then where it went. Three buckets, because they
      // are three different things: answering, loading context in, and
      // re-reading context already loaded.
      const headline =
        data.unit === "dollars"
          ? formatCents(last.costCents ?? 0)
          : formatTokens(replyTokens(last));
      md.appendMarkdown(`Last turn: **${headline}**\n\n`);
      md.appendMarkdown(
        `\u2937 ${this.amount(data.unit, answeringCostCents(last), replyTokens(last))} answering your message\n\n`
      );
      if (last.cacheWriteTokens) {
        md.appendMarkdown(
          `\u2937 ${this.amount(data.unit, last.setupCostCents, last.cacheWriteTokens)} loading context\n\n`
        );
      }
      if (last.cacheReadTokens) {
        md.appendMarkdown(
          `\u2937 ${this.amount(data.unit, last.reusedCostCents, last.cacheReadTokens)} re-reading context\n\n`
        );
      }
      if (last.model) {
        md.appendMarkdown(` \u00b7 ${escapeMd(last.model)}`);
      }
      md.appendMarkdown(`\n\n`);
    }
    if (data.contextTokens) {
      md.appendMarkdown(`Conversation size: **${formatTokens(data.contextTokens)}**\n\n`);
      // Every turn resends the whole conversation, so this number is the cost
      // per message. Starting a new conversation is the only way to reset it.
      if (data.contextTokens >= LARGE_CONTEXT_TOKENS) {
        md.appendMarkdown(`⚠ _Each message resends all of this. A new conversation costs less per message._\n\n`);
      }
    }
    const others = data.agents.filter((a) => !a.isCurrent).slice(0, 4);
    if (others.length) {
      md.appendMarkdown(`Recent sessions:\n\n`);
      for (const a of others) {
        md.appendMarkdown(`\u00b7 ${this.label(a)}: ${this.amount(data.unit, a.costCents, a.tokens)}\n\n`);
      }
    }
    md.appendMarkdown(
      `This month: **${this.amount(data.unit, data.monthlyCostCents, data.monthlyTokens)}**${
        data.monthlySetupTokens
          ? ` \u00b7 +${formatTokens(data.monthlySetupTokens)} loading context`
          : ""
      }${data.monthlyCacheTokens ? ` \u00b7 +${formatTokens(data.monthlyCacheTokens)} re-reading` : ""}\n\n`
    );
    if (data.credits) {
      const cap = data.credits.limitCents != null ? ` of ${formatCents(data.credits.limitCents)}` : "";
      md.appendMarkdown(
        `Usage credits: **${formatCents(data.credits.usedCents)}**${cap} this month\n\n`
      );
      // On a subscription the dollar figures are hidden, since inside the plan
      // they aren't money. With credits switched on they are the rate credits
      // will drain at the moment the plan limit runs out, and that rate is
      // knowable now rather than after the first bill for it.
      const rate: string[] = [];
      if (data.unit === "tokens" && cur) {
        rate.push(`${formatCents(cur.costCents)} this session`);
      }
      if (data.unit === "tokens" && last) {
        rate.push(`${formatCents(last.costCents ?? 0)} last turn`);
      }
      if (rate.length) {
        md.appendMarkdown(`⤷ At API rates: ${rate.join(" · ")}\n\n`);
      }
      // The useful warning isn't "you spent money", it's "the next message is
      // the one that starts costing", which is knowable before it happens.
      const atLimit = this.headlineLimits(data).some((l) => l.pct >= 90);
      md.appendMarkdown(
        atLimit
          ? `⚠ _Near your plan limit. Usage past it bills to credits at API rates._\n\n`
          : `_Usage past your plan limit bills to credits at API rates._\n\n`
      );
    }
    if (data.limits?.length) {
      md.appendMarkdown(`Plan limits:\n\n`);
      for (const l of data.limits) {
        const resets =
          l.resetsAt && l.resetsAt > Date.now()
            ? ` \u00b7 resets in ${formatDuration(l.resetsAt - Date.now())}`
            : "";
        md.appendMarkdown(`\u00b7 ${l.label}: **${Math.round(l.pct)}%** used${resets}\n\n`);
      }
    } else if (data.limitsError) {
      md.appendMarkdown(`\u26a0 Plan limits unavailable: ${escapeMd(data.limitsError)}\n\n`);
    }
    if (data.status === "error") {
      md.appendMarkdown(`\u26a0 Last refresh failed: ${escapeMd(data.error ?? "")}\n\n`);
    }
    md.appendMarkdown(`_Click for details_`);
    return md;
  }

  dispose(): void {
    for (const item of this.items.values()) {
      item.dispose();
    }
    this.items.clear();
  }
}

/**
 * Where a conversation is big enough that its size dominates the cost of each
 * further message. Set below even the smallest current context window, since
 * the point is cost per message, not running out of room.
 */
const LARGE_CONTEXT_TOKENS = 120_000;

/** Escape markdown control characters in externally-derived text. */
function escapeMd(s: string): string {
  return s.replace(/[\\`*_[\]()<>#|~]/g, (ch) => `\\${ch}`);
}
