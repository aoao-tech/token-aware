import * as vscode from "vscode";
import { shortId } from "../agents";
import { ProviderData } from "../provider";
import { ProviderMap } from "../tracker";
import { AgentSpend } from "../types";
import { formatCents, formatDuration, formatTokens, freshTokens } from "../util";

export class DetailsPanel implements vscode.Disposable {
  private static current: DetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  static show(getState: () => ProviderMap | undefined): void {
    if (DetailsPanel.current) {
      DetailsPanel.current.panel.reveal();
      DetailsPanel.current.update(getState());
      return;
    }
    DetailsPanel.current = new DetailsPanel(getState());
  }

  static refreshIfOpen(state: ProviderMap | undefined): void {
    DetailsPanel.current?.update(state);
  }

  private constructor(initial: ProviderMap | undefined) {
    this.panel = vscode.window.createWebviewPanel(
      "tokenAware.details",
      "Token Aware",
      vscode.ViewColumn.Active,
      { enableScripts: false, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => this.dispose());
    this.update(initial);
  }

  update(state: ProviderMap | undefined): void {
    if (this.disposed) {
      return;
    }
    this.panel.webview.html = this.render(state);
  }

  private render(state: ProviderMap | undefined): string {
    if (!state || state.size === 0) {
      return this.wrap(`<p>Loading usage...</p>`);
    }
    const sections = [...state.values()].map((d) => this.renderProvider(d)).join("\n<hr/>\n");
    return this.wrap(sections);
  }

  private renderProvider(d: ProviderData): string {
    const icon = d.label;
    if (d.status === "no-auth") {
      return `<h1>${icon}</h1><p>${escapeHtml(d.error ?? "Unavailable.")}</p>`;
    }

    const amount = (costCents: number | undefined, tokens: number): string =>
      d.unit === "dollars" ? formatCents(costCents ?? 0) : formatTokens(tokens);

    const cur = d.currentAgent;
    const models = (d.models ?? []).slice(0, 8);
    const showCost = d.unit === "dollars";
    const heading = [d.label, d.planLabel, d.unit === "tokens" ? "tokens" : undefined]
      .filter(Boolean)
      .map((s) => escapeHtml(s as string))
      .join(" · ");

    return `
      <h1>${heading}</h1>
      <div class="cards">
        <div class="card">
          <div class="label">Current session</div>
          <div class="value">${cur ? amount(cur.costCents, cur.tokens) : "-"}</div>
          <div class="sub">${cur ? `${escapeHtml(this.label(cur))}` : "no active session"}</div>
        </div>
        <div class="card">
          <div class="label">This month</div>
          <div class="value">${amount(d.monthlyCostCents, d.monthlyTokens)}</div>
          <div class="sub">${formatTokens(d.monthlyTokens)} tokens${
            d.monthlyCacheTokens ? ` · ${formatTokens(d.monthlyCacheTokens)} reused` : ""
          }</div>
        </div>
        <div class="card">
          <div class="label">Last turn</div>
          <div class="value">${d.lastCall ? amount(d.lastCall.costCents, freshTokens(d.lastCall)) : "-"}</div>
          <div class="sub">${
            d.lastCall
              ? (() => {
                  const fresh = freshTokens(d.lastCall);
                  const breakdown = d.lastCall.cacheWriteTokens
                    ? ` (${formatTokens(d.lastCall.outputTokens)} reply + ${formatTokens(
                        d.lastCall.cacheWriteTokens
                      )} setup)`
                    : "";
                  return `${formatTokens(fresh)} tok${breakdown}${
                    d.lastCall.cacheReadTokens ? ` · ${formatTokens(d.lastCall.cacheReadTokens)} reused` : ""
                  }`;
                })()
              : ""
          }</div>
        </div>
      </div>

      ${
        d.currentSessionModels?.length
          ? `<h2>Current session breakdown</h2><table><tr><th>Model</th><th>Tokens</th><th>Reused</th>${
              showCost ? "<th>Cost</th>" : ""
            }</tr>${d.currentSessionModels
              .map(
                (m) =>
                  `<tr><td>${escapeHtml(m.model)}</td><td>${formatTokens(m.totalTokens)}</td><td>${formatTokens(
                    m.cacheTokens ?? 0
                  )}</td>${showCost ? `<td>${formatCents(m.costCents)}</td>` : ""}</tr>`
              )
              .join("")}</table>`
          : ""
      }

      ${
        d.limits?.length
          ? `<h2>Plan limits</h2><table>${d.limits
              .map((l) => {
                const resets =
                  l.resetsAt && l.resetsAt > Date.now()
                    ? `resets in ${formatDuration(l.resetsAt - Date.now())}`
                    : "";
                return `<tr><td>${escapeHtml(l.label)}</td><td><div class="bar"><div style="width:${Math.round(
                  Math.min(100, l.pct)
                )}%"></div></div></td><td>${Math.round(l.pct)}% used</td><td>${resets}</td></tr>`;
              })
              .join("")}</table>`
          : ""
      }

      <h2>Spend by session</h2>
      ${
        d.agents.length
          ? `<table><tr><th></th><th>Session</th>${showCost ? "<th>Cost</th>" : ""}<th>Tokens</th><th>Reused</th><th>Calls</th><th>Last active</th></tr>${d.agents
              .map(
                (a) =>
                  `<tr><td>${a.isCurrent ? "\u25b6" : ""}</td><td>${escapeHtml(
                    this.label(a)
                  )}</td>${showCost ? `<td>${formatCents(a.costCents)}</td>` : ""}<td>${formatTokens(
                    a.tokens
                  )}</td><td>${formatTokens(a.cacheTokens)}</td><td>${a.count}</td><td>${fmtTime(a.lastTs)}</td></tr>`
              )
              .join("")}</table>`
          : "<p>No session activity in the fetched window.</p>"
      }

      <h2>Top models (month)</h2>
      ${
        models.length
          ? `<table><tr><th>Model</th><th>Tokens</th><th>Reused</th>${showCost ? "<th>Cost</th>" : ""}</tr>${models
              .map(
                (m) =>
                  `<tr><td>${escapeHtml(m.model)}</td><td>${formatTokens(m.totalTokens)}</td><td>${formatTokens(
                    m.cacheTokens ?? 0
                  )}</td>${showCost ? `<td>${formatCents(m.costCents)}</td>` : ""}</tr>`
              )
              .join("")}</table>`
          : "<p>No per-model data.</p>"
      }

      <p class="foot">Updated ${fmtTime(d.updatedAt)}${
        d.status === "error" ? ` \u00b7 last refresh failed: ${escapeHtml(d.error ?? "")}` : ""
      }</p>
    `;
  }

  private label(a: AgentSpend): string {
    return a.title ?? shortId(a.conversationId);
  }

  private wrap(body: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
  h1 { font-size: 1.3em; margin-bottom: 8px; }
  h2 { font-size: 1.05em; margin-top: 1.2em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  hr { border: none; border-top: 2px solid var(--vscode-panel-border); margin: 28px 0; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px 16px; min-width: 150px; }
  .label { font-size: 0.8em; opacity: 0.7; }
  .value { font-size: 1.7em; font-weight: 600; }
  .sub { font-size: 0.8em; opacity: 0.7; }
  table { border-collapse: collapse; margin-top: 6px; }
  td, th { text-align: left; padding: 3px 16px 3px 0; }
  th { opacity: 0.7; font-weight: 500; }
  .foot { margin-top: 20px; font-size: 0.8em; opacity: 0.6; }
  .bar { width: 180px; height: 6px; border-radius: 3px; background: var(--vscode-editorWidget-border, #444); overflow: hidden; }
  .bar > div { height: 100%; border-radius: 3px; background: var(--vscode-progressBar-background, #0e70c0); }
</style>
</head>
<body>${body}</body>
</html>`;
  }

  dispose(): void {
    this.disposed = true;
    DetailsPanel.current = undefined;
    this.panel.dispose();
  }
}

function fmtTime(ms: number): string {
  if (!ms) {
    return "";
  }
  return new Date(ms).toLocaleString();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
