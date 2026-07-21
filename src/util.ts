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
