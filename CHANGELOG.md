# Changelog

All notable changes to the **Token Aware** extension are documented in this file.

## [0.2.22]

- Changed: session and monthly figures now follow the same rule as the last turn.
  In tokens mode they count what was actually said, not the context loaded to make
  saying it possible. Opening a session and typing "hi" showed 40k, of which the
  entire exchange was 16 tokens and the other 40,187 was the system prompt, tool
  definitions and project files being loaded once.
- Changed: the details panel's tables now split those three things into their own
  columns (answering / loading context / re-reading context) rather than lumping
  loading in with real usage.
- Per-usage billing is unaffected: dollar figures remain the true totals, since all
  of it is genuinely charged.

## [0.2.21]

- Fixed: open windows no longer rate-limit each other out of the plan-limit gauges.
  The endpoint limits per account, not per window, so each window polling on its own
  could lock the others out. They now share one reading on disk, and a window that
  gets told to wait records the deadline so the others don't go and earn their own.
- Added: the gauges appear immediately when a window opens, from the shared reading,
  instead of staying blank until that window's first successful call.

## [0.2.20]

- Fixed: the plan-limit gauges disappearing mid-session. The usage endpoint allows
  only a handful of calls before returning HTTP 429 with a five minute Retry-After,
  and the extension was asking every 60 seconds. It rate-limited itself within
  minutes of every startup and then stayed locked out, so the gauges vanished and
  the extension was the cause. A good reading is now reused for 10 minutes, which
  is far more often than percentages measured over 5-hour and weekly windows can
  meaningfully change.
- Added: Retry-After is now honored rather than guessed at, and being asked to wait
  is no longer reported as an error when the last good reading is still on screen.

## [0.2.19]

- Fixed: a failed plan-limit lookup no longer blanks the gauges. The last successful
  reading stays on screen with the failure reported next to it, since the lookup
  failing doesn't mean the numbers changed.
- Fixed: the reason is now shown in the details panel, not only in the status bar
  tooltip, so diagnosing it doesn't require knowing to hover.
- Changed: back off to a 5 minute retry after a failed lookup instead of retrying
  every minute. The endpoint is unofficial and polling it harder is the wrong
  response to it saying no.
- Docs: trimmed implementation asides from the README's feature list. Why Claude has
  no calendar-month figure is a design note, not something a reader needs while
  working out what the project is.

## [0.2.18]

- Changed: the status bar shows one figure for the last turn again. 0.2.17 put
  "2.4k last +1.5k setup" there, which is accurate but asks the reader to hold two
  numbers and add them. On per-usage billing it's the one true total charged; on
  subscription plans it's the reply. The itemization moved to the tooltip and
  details panel, where there's room to name each part.
- Fixed: the cost of re-reading already-loaded context was being counted as part
  of the reply. On a long conversation that is the largest share of a turn, so a
  short answer could show most of the turn's dollars against it. It's now its own
  line: answering / loading context / re-reading context, three parts that sum to
  the true total.
- Fixed: an expired Claude Code sign-in now says so instead of making the plan
  limit gauges silently disappear, and a failed limits lookup leaves a marker in
  the status bar rather than an unexplained gap.

## [0.2.17]

- Changed: "Last turn" now separates answering your message ("reply") from
  loading the session's context before it could answer ("setup"), instead of
  merging them into one figure. Typing "ok" and being told it used 60k read as
  invented; almost all of it was context loading, not the reply.
- On per-usage billing the headline stays the true total charged, itemized
  underneath as reply plus setup, so the amount matches the bill and still shows
  where it went. On subscription plans the headline is the reply, with setup
  reported next to it. Nothing is dropped from either view.

## [0.2.16]

- Changed: dropped the word "cache" from all user-facing text in favor of plain
  language. "Last turn" now splits into "reply" (what your message produced) and
  "setup" (the one-time work of loading the session before it can answer), e.g.
  "36k tok (12 reply + 36k setup)". Reused-context is now labeled "reused" instead
  of "cached." A brand-new session answering a one-word "hi" is a tiny reply plus a
  large setup; with the old "cache-write" wording the honest total read like a bug
  to anyone who didn't know the caching mechanics. Dollar and token totals are
  unchanged, so per-usage billing still shows the true cost.

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
