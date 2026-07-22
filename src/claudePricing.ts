/**
 * Anthropic list prices, USD per 1M tokens, taken solely from Anthropic's own
 * published table at https://platform.claude.com/docs/en/about-claude/pricing
 * (read 2026-07-22). Third-party trackers disagree with it and with each
 * other, so none are used here. `npm test` re-derives every published rate
 * from this file, so a stale table fails loudly rather than quietly mispricing.
 *
 * Matched per model *version*, not per family. Matching on the family name
 * alone was wrong by up to 3x in both directions: Opus 4.5 and later cost a
 * third of the Opus 4.1 rates they inherited, while Fable fell through a
 * catch-all to Sonnet's rates despite costing five times as much.
 *
 * Cache multipliers are applied from the base input price rather than written
 * out per row, since they are defined that way and stay correct if a base
 * price changes: 5-minute write 1.25x, 1-hour write 2x, read 0.1x.
 *
 * Fast mode is priced from `usage.speed` in the transcript, which records it
 * per call. It is not a multiplier but its own rate card, and a steep one:
 * Opus 4.8 doubles to $10/$50, Opus 4.7 goes six-fold to $30/$150. Cache
 * multipliers stack on top of it.
 *
 * Still not modelled, because nothing in a transcript identifies them: the
 * Batch API 50% discount and the `inference_geo: "us"` 1.1x. Neither applies
 * to Claude Code usage, and both would only lower or barely raise the figure.
 *
 * Long context needs no special case: Fable 5, Opus 4.6+, Sonnet 5 and Sonnet
 * 4.6 include the full 1M window at standard rates.
 */

/** Base list price per 1M tokens. Cache rates derive from `input`. */
interface Rate {
  input: number;
  output: number;
}

const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
const CACHE_READ = 0.1;

/**
 * Sonnet 5 launched on introductory pricing that expires at the end of
 * 2026-08-31 UTC. Costs are computed from each call's own timestamp so that a
 * month spanning the change stays correct rather than being repriced wholesale.
 */
const SONNET_5_INTRO_ENDS_MS = Date.UTC(2026, 8, 1);

/** First match wins, so version-specific patterns precede family fallbacks. */
const RATES: ReadonlyArray<{ match: RegExp; rate: Rate | ((atMs: number) => Rate) }> = [
  // Fable / Mythos.
  { match: /fable|mythos/, rate: { input: 10, output: 50 } },
  // Opus 4.5 and later. Opus 4.1 and 4 stay on the old, far higher rates.
  { match: /opus-4-(?:5|6|7|8)/, rate: { input: 5, output: 25 } },
  { match: /opus-4(?:-1)?\b/, rate: { input: 15, output: 75 } },
  {
    match: /sonnet-5/,
    rate: (atMs) => (atMs < SONNET_5_INTRO_ENDS_MS ? { input: 2, output: 10 } : { input: 3, output: 15 }),
  },
  { match: /sonnet/, rate: { input: 3, output: 15 } },
  { match: /haiku-3/, rate: { input: 0.8, output: 4 } },
  { match: /haiku/, rate: { input: 1, output: 5 } },
  // Unknown model: price as Opus 4.8 rather than the cheapest thing going, so
  // a model this table has not learned yet errs toward over-reporting spend.
  // Silently under-reporting money is the worse failure for this tool.
  { match: /./, rate: { input: 5, output: 25 } },
];

/**
 * Fast mode rates, which replace the standard ones rather than scaling them.
 * Only Opus 4.8 and 4.7 offer it; anything else with `speed: "fast"` set runs
 * and bills at standard speed, so it falls through to the normal table.
 */
const FAST_RATES: ReadonlyArray<{ match: RegExp; rate: Rate }> = [
  { match: /opus-4-8/, rate: { input: 10, output: 50 } },
  { match: /opus-4-7/, rate: { input: 30, output: 150 } },
];

function rateFor(model: string | undefined, atMs: number, fast: boolean): Rate {
  const m = (model ?? "").toLowerCase();
  if (fast) {
    for (const entry of FAST_RATES) {
      if (entry.match.test(m)) {
        return entry.rate;
      }
    }
  }
  for (const entry of RATES) {
    if (entry.match.test(m)) {
      return typeof entry.rate === "function" ? entry.rate(atMs) : entry.rate;
    }
  }
  return { input: 5, output: 25 };
}

export interface ClaudeTokens {
  input: number;
  output: number;
  cacheRead: number;
  /** Cache writes whose duration the transcript did not record. */
  cacheWrite: number;
  /** Cache writes known to be 5-minute, when the transcript splits them out. */
  cacheWrite5m?: number;
  /** Cache writes known to be 1-hour, billed at 2x input rather than 1.25x. */
  cacheWrite1h?: number;
  /**
   * `usage.speed` as recorded for the call. "fast" bills Opus 4.8 at double
   * and Opus 4.7 at six times the standard rate, so it is read rather than
   * assumed. Absent means standard, which is right: fast mode is opt-in.
   */
  speed?: string;
}

/**
 * Estimated cost in cents for a Claude call.
 *
 * `atMs` is the call's own timestamp, used only where a price changed on a
 * date. It defaults to now, which is right for a live call and harmless for
 * every model whose price is flat.
 */
export function claudeCostCents(
  model: string | undefined,
  t: ClaudeTokens,
  atMs: number = Date.now()
): number {
  const r = rateFor(model, atMs, t.speed === "fast");
  // Prefer the recorded 5m/1h split; fall back to the undifferentiated total.
  // Claude Code writes a 1-hour cache in normal use, and pricing it as
  // 5-minute understates every cache write by 60%, so the fallback assumes
  // 1-hour rather than the cheaper option.
  const split = t.cacheWrite5m != null || t.cacheWrite1h != null;
  const write5m = split ? t.cacheWrite5m ?? 0 : 0;
  const write1h = split ? t.cacheWrite1h ?? 0 : t.cacheWrite;
  const dollars =
    (t.input * r.input +
      t.output * r.output +
      t.cacheRead * r.input * CACHE_READ +
      write5m * r.input * CACHE_WRITE_5M +
      write1h * r.input * CACHE_WRITE_1H) /
    1_000_000;
  return dollars * 100;
}
