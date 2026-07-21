import * as vscode from "vscode";
import { shortId } from "./agents";
import { DisplayMode, TrackerConfig } from "./config";
import { ProviderData, ProviderUnit } from "./provider";
import { ProviderMap } from "./tracker";
import { AgentSpend } from "./types";
import { formatCents, formatTokens, freshTokens } from "./util";

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
      // Right-aligned, low priority => far-right edge of the status bar, so it
      // doesn't rearrange the familiar left-side items. Lower priority sits
      // further right, so earlier providers (lower index) stay to the left.
      item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -10 - index);
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
      item.tooltip = new vscode.MarkdownString(`**${data.label}**\n\n${data.error ?? "Unavailable."}`);
      item.backgroundColor = undefined;
      return;
    }
    if (data.status === "error" && !data.currentAgent && data.monthlyTokens === 0) {
      item.text = `${icon} ${data.label} $(error)`;
      item.tooltip = new vscode.MarkdownString(`**${data.label}**\n\n${data.error ?? "Refresh failed."}`);
      return;
    }

    const fmtAmount = (costCents: number | undefined, tokens: number): string =>
      data.unit === "dollars" ? formatCents(costCents ?? 0) : formatTokens(tokens);

    const agent = `${fmtAmount(data.currentAgent?.costCents, data.currentAgent?.tokens ?? 0)} session`;
    const last = data.lastCall
      ? `${fmtAmount(data.lastCall.costCents, freshTokens(data.lastCall))} last`
      : undefined;
    const monthly = `${fmtAmount(data.monthlyCostCents, data.monthlyTokens)} mo`;

    const parts: string[] = [];
    if (mode !== "monthly") {
      parts.push(agent);
    }
    if (last) {
      parts.push(last);
    }
    if (mode !== "session") {
      parts.push(monthly);
    }
    item.text = `${icon} ${parts.join(" \u00b7 ")}`;
    item.backgroundColor = this.pickBackground(data);
    item.tooltip = this.buildTooltip(data);
  }

  private pickBackground(data: ProviderData): vscode.ThemeColor | undefined {
    const pct = data.quotaPct;
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

  private label(a: AgentSpend): string {
    return a.title ?? shortId(a.conversationId);
  }

  private amount(unit: ProviderUnit, costCents: number | undefined, tokens: number): string {
    return unit === "dollars" ? formatCents(costCents ?? 0) : formatTokens(tokens);
  }

  private buildTooltip(data: ProviderData): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${data.label} token usage**\n\n`);
    if (data.planLabel) {
      md.appendMarkdown(`Plan: **${data.planLabel}**\n\n`);
    }

    const cur = data.currentAgent;
    if (cur) {
      md.appendMarkdown(`Current session: **${this.label(cur)}**\n\n`);
      md.appendMarkdown(
        `\u2937 **${this.amount(data.unit, cur.costCents, cur.tokens)}** \u00b7 ${formatTokens(cur.tokens)} tok${
          cur.cacheTokens ? ` (+${formatTokens(cur.cacheTokens)} cached)` : ""
        } \u00b7 ${cur.count} calls\n\n`
      );
    }
    const last = data.lastCall;
    if (last) {
      md.appendMarkdown(
        `Last call: **${this.amount(data.unit, last.costCents, freshTokens(last))}** \u00b7 ${formatTokens(freshTokens(last))} tok${
          last.cacheReadTokens ? ` (+${formatTokens(last.cacheReadTokens)} cached)` : ""
        }`
      );
      if (last.model) {
        md.appendMarkdown(` \u00b7 ${last.model}`);
      }
      md.appendMarkdown(`\n\n`);
    }
    const others = data.agents.filter((a) => !a.isCurrent).slice(0, 4);
    if (others.length) {
      md.appendMarkdown(`Recent sessions:\n\n`);
      for (const a of others) {
        md.appendMarkdown(`\u00b7 ${this.label(a)} — ${this.amount(data.unit, a.costCents, a.tokens)}\n\n`);
      }
    }
    md.appendMarkdown(
      `This month: **${this.amount(data.unit, data.monthlyCostCents, data.monthlyTokens)}** \u00b7 ${formatTokens(data.monthlyTokens)} tok${
        data.monthlyCacheTokens ? ` (+${formatTokens(data.monthlyCacheTokens)} cached)` : ""
      }\n\n`
    );
    if (data.status === "error") {
      md.appendMarkdown(`\u26a0 Last refresh failed: ${data.error}\n\n`);
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
