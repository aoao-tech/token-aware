/**
 * Approximate Anthropic pricing (USD per 1M tokens). Cache read is ~0.1x input;
 * cache creation (5m) is ~1.25x input. These are estimates for the optional
 * "dollars" mode; token counts remain exact. Adjust here if rates change.
 */
interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const RATES: Record<"opus" | "sonnet" | "haiku", Rate> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1.0 },
};

function rateFor(model: string | undefined): Rate {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) {
    return RATES.opus;
  }
  if (m.includes("haiku")) {
    return RATES.haiku;
  }
  return RATES.sonnet;
}

export interface ClaudeTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Estimated cost in cents for a Claude call. */
export function claudeCostCents(model: string | undefined, t: ClaudeTokens): number {
  const r = rateFor(model);
  const dollars =
    (t.input * r.input +
      t.output * r.output +
      t.cacheRead * r.cacheRead +
      t.cacheWrite * r.cacheWrite) /
    1_000_000;
  return dollars * 100;
}
