# Changelog

All notable changes to the **Token Aware** extension are documented in this file.

## [0.2.15]

- Changed: "Last turn" now always splits generated output from cache-write
  (e.g. "3.5k generated + 2.9k cache-write"), not just when cache-write
  dominates the total. Cache-write is a distinct cost driver from the reply
  itself even at modest proportions, and this session's usage showed the
  split is informative either way, small turns and huge ones alike.

## [0.2.14]

- Added: "Last turn" now breaks out cache-write tokens from generated output
  when writes dominate (e.g. "5k generated + 339k cache-write"). A growing
  conversation periodically forces a full re-cache of its context, which can
  dwarf the actual reply and otherwise looked like an unexplainably large,
  untrustworthy number.

## [0.2.13]

- Changed: "Last turn" (formerly "Last call") for Claude now sums every API
  call since your last real message, instead of showing just the single
  most recent one. A reply is often many tool-call round trips, each a
  separate, differently-sized request; showing only the trailing one made
  the number look like it was jumping around erratically as each sub-call
  finished. This matters most for per-usage/API billing, where this figure
  is meant to answer "what did my last message actually cost me."

## [0.2.12]

- Added: a "Current session breakdown" table in the details panel, showing
  which models make up the current session's token total (and cached tokens,
  and cost in dollars mode). Previously the per-model table only covered the
  whole month, with no way to see what a single session's number was made of.
- Fixed: `resets in` durations over 24 hours now show as `4d 1h` instead of
  `97h 39m`.

## [0.2.11]

- Fixed: status bar items now sit to the right of VS Code's built-in Problems
  (errors/warnings) indicator. 0.2.10's priority guess had it backwards,
  Problems uses a lower priority than assumed and ended up to our right
  instead of our left.

## [0.2.10]

- Changed: status bar items moved from the far right to the left side, right
  next to VS Code's built-in Problems (errors/warnings) indicator.

## [0.2.9]

- Fixed: plan-limit fetch failures are no longer silently swallowed. Genuine
  errors (network, HTTP, unexpected response shape) are now surfaced in the
  tooltip as "Plan limits unavailable: ...", distinct from the expected case
  of not being logged in with a plan that has limits at all.

## [0.2.8]

- Fixed: restored Cursor's premium-request quota percentage in the status bar text.
  It was silently dropped when 0.2.3 split the badge into per-bucket labels for
  Claude; Cursor doesn't have kind-tagged limit buckets, so it now falls back to
  the single `%` figure it always had.
- Docs: corrected the README's status bar example, which still showed Claude with
  a monthly total and no plan-limit percentages.

## [0.2.7]

- Docs: added this changelog, following the structure VS Code's own extension
  generator scaffolds by default
  ([Your First Extension](https://code.visualstudio.com/api/get-started/your-first-extension)).

## [0.2.6]

- Fixed: dropped the calendar-month total from Claude's status bar. Claude's plan
  limits reset on rolling 5h/7-day windows, not the calendar month, so the figure
  no longer belongs next to the session/week percentages. Still available in the
  tooltip and details panel. Cursor keeps its monthly figure since Cursor bills by
  calendar month.

## [0.2.5]

- Fixed: plan detection no longer assumes a claude.ai login means flat-fee billing.
  Team/Enterprise seats sign in via corporate SSO the same way Pro/Max users do,
  with no API key ever entered, but are commonly billed per-usage. `billingType` is
  now the primary signal; only recognized personal tiers (Free/Pro/Max) are treated
  as flat-fee.

## [0.2.4]

- Fixed: sessions are now titled from their most recent message instead of their
  first. Long-running sessions often open with a lengthy task-priming brief, which
  made for a useless title once truncated. Falls back to Claude Code's own summary
  entry when one exists.
- Fixed: `truncate()` now backs up to the last word boundary instead of cutting
  titles mid-word.

## [0.2.3]

- Fixed: the status bar now shows Claude's session (5h) and all-models weekly usage
  as two explicit percentages instead of a single blended max, which could hide the
  weekly number behind a higher per-model figure.

## [0.2.2]

- Added: plan-limit gauges for Claude subscription plans, the same session (5h) and
  weekly usage percentages shown at claude.ai → Settings → Usage, with warning
  colors at 90%/100%.
- Fixed: hardened the status bar tooltip against markdown injection from
  transcript-derived session titles.
- Fixed: publisher renamed to `aoao-tech`.
- Docs: removed em dashes from prose and tooltip text.

## [0.2.1]

- Fixed: headline token counts now show only newly processed tokens (fresh input +
  output + cache writes). Cache reads, the whole conversation context re-served
  from the prompt cache on every call, are shown separately as "cached" so a
  200-token reply no longer displays as a 100k-token call.

## [0.2.0]

- Renamed the project to **Token Aware** (from "Cursor Token Spend Tracker").
- Added: auto-detection of installed tools (Cursor, Claude Code) and of billing
  plan (subscription vs. per-usage) to pick dollars or tokens automatically.
- Added: Claude session list scoped to the open workspace by default, with real
  session titles resolved from transcripts instead of raw IDs; subagent/sidechain
  transcripts excluded from the list.

## [0.1.0]

- Initial release: live Cursor and Claude Code token/dollar spend in the status
  bar, with a details panel showing spend by session and top models.
