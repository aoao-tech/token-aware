/**
 * These formatters decide what the status bar actually says, and the token
 * splits decide which number gets called "your last message". Both have been
 * changed repeatedly on judgement grounds (0.2.17 through 0.2.23), so the
 * intent behind each is pinned here.
 */
import { UsageEvent } from "./types";
import { formatCents, formatDuration, formatTokens, freshTokens, replyTokens, titleCase } from "./util";
import { eq, suite, test } from "./testHarness";

suite("util");

function event(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    timestamp: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    ...over,
  };
}

test("formatTokens keeps small numbers exact and abbreviates the rest", () => {
  eq(formatTokens(0), "0", "zero");
  eq(formatTokens(999), "999", "below 1k stays exact");
  eq(formatTokens(1000), "1.0k", "1k gets a decimal");
  eq(formatTokens(9999), "10.0k", "just under 10k");
  eq(formatTokens(10_000), "10k", "10k and above drops the decimal");
  eq(formatTokens(162_233), "162k", "six figures");
  eq(formatTokens(1_000_000), "1.00M", "a million");
  eq(formatTokens(513_643_511), "513.64M", "half a billion");
});

test("formatCents always shows two decimal places", () => {
  eq(formatCents(0), "$0.00", "zero");
  eq(formatCents(1), "$0.01", "one cent");
  eq(formatCents(250), "$2.50", "dollars and cents");
  eq(formatCents(83_509), "$835.09", "a month of usage");
  // Sub-cent amounts round rather than showing a misleading $0.00 with digits.
  eq(formatCents(0.4), "$0.00", "rounds down");
  eq(formatCents(0.6), "$0.01", "rounds up");
});

test("formatDuration scales its unit to the size of the gap", () => {
  eq(formatDuration(0), "0m", "zero");
  eq(formatDuration(59_000), "0m", "under a minute");
  eq(formatDuration(60_000), "1m", "one minute");
  eq(formatDuration(59 * 60_000), "59m", "just under an hour");
  eq(formatDuration(60 * 60_000), "1h 0m", "one hour");
  eq(formatDuration(5 * 60 * 60_000), "5h 0m", "a session window");
  eq(formatDuration(25 * 60 * 60_000), "1d 1h", "over a day");
  eq(formatDuration(7 * 24 * 60 * 60_000), "7d 0h", "a weekly window");
});

test("titleCase turns endpoint keys into labels", () => {
  eq(titleCase("opus"), "Opus", "single word");
  eq(titleCase("weekly_scoped"), "Weekly Scoped", "underscores");
  eq(titleCase("seven-day"), "Seven Day", "hyphens");
});

/**
 * freshTokens excludes cache reads on purpose: they are the whole conversation
 * being re-served every call, so including them makes a short message look
 * enormous. replyTokens goes further and excludes cache writes too, since
 * loading context is not something the user typed.
 */
test("freshTokens counts new work, not context re-read", () => {
  const e = event({ inputTokens: 100, outputTokens: 50, cacheWriteTokens: 2000, cacheReadTokens: 90_000 });
  eq(freshTokens(e), 2150, "input + output + cache writes");
});

test("replyTokens counts only the exchange itself", () => {
  const e = event({ inputTokens: 100, outputTokens: 50, cacheWriteTokens: 2000, cacheReadTokens: 90_000 });
  eq(replyTokens(e), 150, "input + output");
});

test("the three token views of one real-shaped call stay ordered", () => {
  // A first message on a fresh session: tiny exchange, huge context load.
  const e = event({ inputTokens: 16, outputTokens: 120, cacheWriteTokens: 40_187, cacheReadTokens: 0 });
  eq(replyTokens(e), 136, "what the user would call their message");
  eq(freshTokens(e), 40_323, "what was actually processed");
  eq(formatTokens(replyTokens(e)), "136", "and it reads as a small number");
});
