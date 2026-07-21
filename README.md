# Token Aware

A VS Code / Cursor extension that keeps your **AI token/dollar usage visible in the
status bar in real time** — so you stay aware of how much you're burning without
opening a usage dashboard.

It auto-detects which tools you use (**Cursor**, **Claude Code**, or both) and shows
one status bar item per detected tool. Tools that aren't on your machine simply
don't appear.

## What it does

- One status bar item per detected tool, e.g. `⚡ $1.93 session · $0.42 last · $1301.81 mo`
  (Cursor) and `✨ 45.2k session · 122k last · 2.3M mo` (Claude).
- **Auto plan detection**: figures out whether you're on a subscription (Claude
  Pro/Max, Cursor individual plans → shows tokens) or per-usage billing (API keys,
  Cursor enterprise/business → shows dollars). Manual override available.
- **Per-session spend**: tracks the session you're currently working in. It becomes
  "current" the moment you send a message in it.
- Updates on a poll interval **and** instantly right after each AI turn.
- Click it for a details panel: current session, spend-by-session table, monthly
  totals, and top models — per tool.
- Claude session list is scoped to your open workspace by default (background runs,
  subagents, and other projects are excluded from the list; monthly totals still
  count everything).
- **Honest token counting**: the headline number is tokens the model *newly
  processed* (fresh input + output + cache writes). Cache reads — the whole
  conversation context re-served from the prompt cache on every call, at ~10% of
  the input price — are shown separately as "cached" so a 200-token reply doesn't
  masquerade as a 100k-token call.

## How it works

### Cursor
Cursor doesn't store real per-request token counts locally (the chat DB records zeros),
so the numbers come from **Cursor's own usage backend** — the same data behind
[cursor.com/dashboard/usage](https://cursor.com/dashboard/usage):

1. Reads your local session token from Cursor's state DB
   (`ItemTable` key `cursorAuth/accessToken` in `state.vscdb`), read-only, via the
   system `sqlite3` binary. Nothing is written to that DB.
2. Calls Cursor's usage endpoints with that token for per-request token usage, cost,
   and plan type.
3. Watches `~/.cursor/projects/*/agent-transcripts/<id>/*.jsonl` to know which agent is
   active and to refresh immediately after each turn.

### Claude Code
Claude Code writes full transcripts to `~/.claude/projects/<slug>/<sessionId>.jsonl`, and
every assistant message includes an exact `usage` block. So this provider is **fully
local, accurate, and needs no auth**: it reads those files, dedupes streamed chunks by
`requestId`, groups by session, resolves session titles, and (optionally) converts tokens
to dollars with a bundled Anthropic pricing table. Plan detection reads the local Claude
Code login metadata (subscription vs. API billing) — nothing leaves your machine.

> Note: neither editor exposes the focused chat tab to extensions, so "current session"
> means the conversation you most recently interacted with (it updates as soon as you
> send in it).

## Requirements

- Cursor tracking: be signed in to Cursor; `sqlite3` on PATH (preinstalled on macOS;
  on Windows: `winget install SQLite.SQLite`).
- Claude tracking: Claude Code installed (data under `~/.claude/projects`). No auth needed.

## Develop / run

```bash
npm install
npm run build      # or: npm run watch
```

Open this folder in VS Code/Cursor and press **F5** to launch the Extension Development Host.

## Package / install locally

```bash
npm run package    # produces token-aware-<version>.vsix
```

Install the `.vsix` via the Extensions view → `...` → **Install from VSIX...**

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `tokenAware.pollIntervalSeconds` | `30` | How often to refresh usage data. |
| `tokenAware.displayMode` | `both` | `session`, `monthly`, or `both`. |
| `tokenAware.instantRefreshOnTurn` | `true` | Refresh immediately after each AI turn. |
| `tokenAware.cursor.enabled` | `auto` | `auto` (show only if Cursor detected), `on`, `off`. |
| `tokenAware.cursor.unit` | `auto` | `auto` (detect from plan), `dollars`, `tokens`. |
| `tokenAware.claude.enabled` | `auto` | `auto` (show only if Claude Code detected), `on`, `off`. |
| `tokenAware.claude.unit` | `auto` | `auto` (detect from plan), `dollars`, `tokens`. |
| `tokenAware.claude.sessionScope` | `workspace` | List sessions from the open workspace only, or `all`. |

## Commands

- **Token Aware: Refresh Now**
- **Token Aware: Show Details**

## Privacy

Everything runs locally. The Cursor provider only talks to `cursor.com` (the same host
Cursor itself uses); the Claude provider makes no network calls at all. No third-party
telemetry. Auth tokens are read at runtime and never stored or transmitted anywhere
except to the tool's own backend.

## Notes / disclaimers

- Not affiliated with or endorsed by Anysphere (Cursor) or Anthropic (Claude).
- Cursor's usage endpoints (`src/cursorApi.ts`) are **unofficial** and may change; the
  client fails soft (shows "n/a" instead of erroring).
- Claude dollar amounts are **estimates** from a bundled pricing table
  (`src/claudePricing.ts`); token counts are exact.
- Plan auto-detection is heuristic (e.g. an enterprise seat without usage-based billing
  is still shown in dollars) — use the `unit` settings to override.

## License

MIT
