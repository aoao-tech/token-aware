/**
 * Every expected number here is transcribed from Anthropic's published pricing
 * table, https://platform.claude.com/docs/en/about-claude/pricing, read
 * 2026-07-22. No third-party source is used: they disagree with the official
 * table and with each other.
 *
 * The point of this file is that `claudePricing.ts` stores only base input and
 * output rates and derives the three cache columns from multipliers. That is
 * less duplication but more room to be silently wrong, so every published cell
 * is checked against the derivation, not just the ones the extension happens
 * to hit today.
 *
 * Run with `npm test`.
 */
import { claudeCostCents } from "./claudePricing";

const MTOK = 1_000_000;
const JULY_2026 = Date.UTC(2026, 6, 22);
const SEPT_2026 = Date.UTC(2026, 8, 15);

let failures = 0;
let checks = 0;

/** Cost of 1M tokens of a single kind, in dollars, for readable expectations. */
function perMTok(
  model: string,
  kind: "input" | "output" | "cacheRead" | "cacheWrite5m" | "cacheWrite1h",
  atMs = JULY_2026
): number {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const t =
    kind === "cacheWrite5m"
      ? { ...zero, cacheWrite5m: MTOK, cacheWrite1h: 0 }
      : kind === "cacheWrite1h"
        ? { ...zero, cacheWrite5m: 0, cacheWrite1h: MTOK }
        : { ...zero, [kind]: MTOK };
  return claudeCostCents(model, t, atMs) / 100;
}

function eq(name: string, got: number, want: number): void {
  checks++;
  const ok = Math.abs(got - want) < 1e-9;
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}\n        got $${got}  want $${want}`);
  }
}

/** One row of the published table, checked cell by cell. */
function row(
  label: string,
  model: string,
  published: { input: number; write5m: number; write1h: number; read: number; output: number },
  atMs = JULY_2026
): void {
  eq(`${label} input`, perMTok(model, "input", atMs), published.input);
  eq(`${label} output`, perMTok(model, "output", atMs), published.output);
  eq(`${label} 5m cache write`, perMTok(model, "cacheWrite5m", atMs), published.write5m);
  eq(`${label} 1h cache write`, perMTok(model, "cacheWrite1h", atMs), published.write1h);
  eq(`${label} cache read`, perMTok(model, "cacheRead", atMs), published.read);
}

// --- The published model pricing table, row for row. --------------------------
row("Fable 5", "claude-fable-5", { input: 10, write5m: 12.5, write1h: 20, read: 1, output: 50 });
row("Mythos 5", "claude-mythos-5", { input: 10, write5m: 12.5, write1h: 20, read: 1, output: 50 });
row("Opus 4.8", "claude-opus-4-8", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 });
row("Opus 4.7", "claude-opus-4-7", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 });
row("Opus 4.6", "claude-opus-4-6", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 });
row("Opus 4.5", "claude-opus-4-5", { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 });
row("Opus 4.1", "claude-opus-4-1", { input: 15, write5m: 18.75, write1h: 30, read: 1.5, output: 75 });
row("Opus 4", "claude-opus-4-20250514", { input: 15, write5m: 18.75, write1h: 30, read: 1.5, output: 75 });
row("Sonnet 5 (intro)", "claude-sonnet-5", { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 });
row(
  "Sonnet 5 (standard)",
  "claude-sonnet-5",
  { input: 3, write5m: 3.75, write1h: 6, read: 0.3, output: 15 },
  SEPT_2026
);
row("Sonnet 4.6", "claude-sonnet-4-6", { input: 3, write5m: 3.75, write1h: 6, read: 0.3, output: 15 });
row("Sonnet 4.5", "claude-sonnet-4-5-20250929", { input: 3, write5m: 3.75, write1h: 6, read: 0.3, output: 15 });
row("Haiku 4.5", "claude-haiku-4-5-20251001", { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 });
row("Haiku 3.5", "claude-haiku-3-5-20241022", { input: 0.8, write5m: 1, write1h: 1.6, read: 0.08, output: 4 });

// --- Anthropic's own worked examples, reproduced exactly. ---------------------
// "A one-hour coding session using Claude Opus 4.8 that consumes 50,000 input
// tokens and 15,000 output tokens" -> $0.25 + $0.375 in token charges.
eq(
  "docs worked example: 50k in + 15k out",
  claudeCostCents("claude-opus-4-8", { input: 50_000, output: 15_000, cacheRead: 0, cacheWrite: 0 }, JULY_2026) / 100,
  0.625
);
// "If prompt caching is active and 40,000 of the input tokens are cache reads"
// -> $0.05 + $0.02 + $0.375.
eq(
  "docs worked example: with 40k cache read",
  claudeCostCents(
    "claude-opus-4-8",
    { input: 10_000, output: 15_000, cacheRead: 40_000, cacheWrite: 0 },
    JULY_2026
  ) / 100,
  0.445
);

// --- Regressions for the bugs that made this file necessary. -----------------
// Matching on family name charged every current Opus the deprecated 4.1 rate.
eq("Opus 4.8 is not billed as Opus 4.1", perMTok("claude-opus-4-8", "input"), 5);
// Fable matched neither "opus" nor "haiku" and fell through to Sonnet.
eq("Fable is not billed as Sonnet", perMTok("claude-fable-5", "input"), 10);
// Haiku 4.5 was billed at the retired Haiku 3.5 rate.
eq("Haiku 4.5 is not billed as Haiku 3.5", perMTok("claude-haiku-4-5-20251001", "input"), 1);
// A cache write of unrecorded duration must assume the costlier 1-hour rate:
// Claude Code writes a 1-hour cache in normal use, and under-reporting spend
// is the worse failure for a tool that exists to warn about it.
eq(
  "unsplit cache write assumes 1h, not 5m",
  claudeCostCents("claude-fable-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: MTOK }, JULY_2026) / 100,
  20
);
// An unknown model must not be priced as the cheapest option.
eq("unknown model prices as Opus 4.8", perMTok("claude-something-unreleased", "input"), 5);

// --- Fast mode, read from usage.speed rather than assumed away. --------------
const fast = (model: string, kind: "input" | "output"): number =>
  claudeCostCents(
    model,
    { input: kind === "input" ? MTOK : 0, output: kind === "output" ? MTOK : 0, cacheRead: 0, cacheWrite: 0, speed: "fast" },
    JULY_2026
  ) / 100;
eq("fast Opus 4.8 input is $10", fast("claude-opus-4-8", "input"), 10);
eq("fast Opus 4.8 output is $50", fast("claude-opus-4-8", "output"), 50);
eq("fast Opus 4.7 input is $30", fast("claude-opus-4-7", "input"), 30);
eq("fast Opus 4.7 output is $150", fast("claude-opus-4-7", "output"), 150);
// Cache multipliers stack on top of fast mode's rate card, not the standard one.
eq(
  "fast Opus 4.8 1h cache write is 2x its $10 base",
  claudeCostCents(
    "claude-opus-4-8",
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: MTOK, speed: "fast" },
    JULY_2026
  ) / 100,
  20
);
// Fast mode is unavailable on Opus 4.6 and below: such a request runs and
// bills at standard speed, so the flag must not inflate it.
eq(
  "fast flag on Opus 4.6 still bills standard",
  claudeCostCents("claude-opus-4-6", { input: MTOK, output: 0, cacheRead: 0, cacheWrite: 0, speed: "fast" }, JULY_2026) /
    100,
  5
);
eq(
  "fast flag on Sonnet still bills standard",
  claudeCostCents("claude-sonnet-5", { input: MTOK, output: 0, cacheRead: 0, cacheWrite: 0, speed: "fast" }, JULY_2026) /
    100,
  2
);
// "standard" and an absent field must both mean standard pricing.
eq(
  "speed=standard is standard pricing",
  claudeCostCents(
    "claude-opus-4-8",
    { input: MTOK, output: 0, cacheRead: 0, cacheWrite: 0, speed: "standard" },
    JULY_2026
  ) / 100,
  5
);
eq("absent speed is standard pricing", perMTok("claude-opus-4-8", "input"), 5);

console.log(failures ? `\n${failures} of ${checks} checks FAILED` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
