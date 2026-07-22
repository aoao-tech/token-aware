# Token Aware

A VS Code / Cursor extension that keeps your **AI token/dollar usage visible in the
status bar in real time**, so you stay aware of how much you're burning without
opening a usage dashboard.

It auto-detects which tools you use (**Cursor**, **Claude Code**, or both) and shows
one status bar item per detected tool. Tools that aren't on your machine simply
don't appear.

## What it does

- One status bar item per detected tool:
  - `⚡ $1.93 session · $0.42 last · $1301.81 mo · 62%` (Cursor)
  - `✨ 45.2k session · 922 last · 43% session · 9% week` (Claude)
- **Auto plan detection**: dollars if you're billed per usage, tokens if you're on a
  flat monthly plan. Signing in with corporate SSO under an organization's per-usage
  contract is detected too, so you never need to hold an API key yourself. Manual
  override if it guesses wrong.
- **Per-session spend**: tracks the session you're working in. It becomes "current"
  the moment you send a message in it.
- **The cost of your message, not your last API call**: one reply is often many
  round trips to the model. "Last" covers everything since you hit enter, so it
  answers "what did that cost me" instead of flickering between sub-calls.
- **Where the cost actually went**: hover for the split between answering your
  message, loading context in, and re-reading context already loaded. On a long
  conversation the last one is usually the biggest share, which is the part most
  people don't expect.
- **Plan-limit gauges** (Claude subscription plans): the session and weekly
  percentages from claude.ai → Settings → Usage, with warning colors at 90% and 100%.
- Updates on a poll interval **and** instantly after each AI turn.
- Click for a details panel: current session, spend by session, monthly totals, top
  models, and a per-model breakdown of the current session.
- Claude session list is scoped to your open workspace by default. Monthly totals
  still count everything.

## How it works

### Cursor
Cursor doesn't store real per-request token counts locally (the chat DB records zeros),
so the numbers come from **Cursor's own usage backend**, the same data behind
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
Code login metadata (`billingType` and plan tier); a claude.ai login by itself isn't
treated as proof of flat-fee billing, since Team/Enterprise seats sign in the same way
but are commonly billed per-usage. Nothing leaves your machine for this check.

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
Cursor itself uses). The Claude provider reads transcripts entirely locally; for
subscription accounts it makes one authenticated call to `api.anthropic.com` (the same
endpoint Claude Code's own /usage screen uses) to show plan-limit percentages. No
third-party telemetry. Auth tokens are read at runtime and never stored or transmitted
anywhere except to the tool's own backend.

## Notes / disclaimers

- Not affiliated with or endorsed by Anysphere (Cursor) or Anthropic (Claude).
- Cursor's usage endpoints (`src/cursorApi.ts`) are **unofficial** and may change; the
  client fails soft (shows "n/a" instead of erroring).
- Claude dollar amounts come from a bundled table of Anthropic list prices
  (`src/claudePricing.ts`), matched per model version and dated 2026-07-22; token
  counts are exact. Fast mode is priced from `usage.speed`, so `/fast` calls bill
  at their real premium rather than being assumed away. Two modifiers are not
  modelled because nothing in a transcript records them, and neither applies to
  Claude Code: the Batch API's 50% discount and the `inference_geo: "us"` 1.1x.
  Run `npm test` to re-derive every published rate from the table.
- Plan auto-detection is heuristic (e.g. an enterprise seat without usage-based billing
  is still shown in dollars); use the `unit` settings to override.

## License

MIT
