import { UsageEvent } from "./types";

/**
 * Tokens the model newly processed in a call: fresh input, generated output,
 * and cache writes. Cache READS (the whole conversation context re-served
 * from cache on every call) are excluded; they dwarf the intuitive "how much
 * did this call use" number and are billed at a fraction of the input price.
 */
export function freshTokens(e: UsageEvent): number {
  return e.inputTokens + e.outputTokens + e.cacheWriteTokens;
}

/**
 * Tokens spent answering: the message sent in plus the reply generated.
 * This is the number a person means by "what did my last message use", so
 * it's the headline. Loading context into the cache is real spend too, but
 * it's overhead the user didn't ask for, so it's reported beside this as
 * "setup" rather than folded into it.
 */
export function replyTokens(e: UsageEvent): number {
  return e.inputTokens + e.outputTokens;
}

/** Tokens spent answering: the total with the context-loading ("setup") share removed. */
export function answeringTokens(total: number | undefined, setup: number | undefined): number {
  return Math.max(0, (total ?? 0) - (setup ?? 0));
}

/**
 * Cost of answering alone, in cents: the turn's cost with both the
 * context-loading ("setup") and re-reading ("reused") shares taken out, so it
 * lines up with those two being itemized separately.
 */
export function answeringCostCents(e: UsageEvent): number {
  return Math.max(0, (e.costCents ?? 0) - (e.setupCostCents ?? 0) - (e.reusedCostCents ?? 0));
}

export function formatTokens(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  }
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ${mins % 60}m`;
  }
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
