import * as fs from "node:fs";
import * as path from "node:path";
import { PlanLimit } from "./provider";

/** A plan-limit reading shared by every window on this machine. */
export interface StoredLimits {
  /** When the reading was taken. */
  at: number;
  limits: PlanLimit[];
  /** Don't call the endpoint again before this time (server-imposed). */
  retryUntil?: number;
}

/**
 * The usage endpoint rate-limits per account, not per window, so several open
 * windows polling independently will lock each other out. This keeps one
 * reading on disk that they all share, which also means a newly opened window
 * shows the gauges immediately instead of sitting blank until its first call.
 *
 * Every operation fails soft: a cache that can't be read or written should
 * cost freshness, never the feature.
 */
export class LimitsStore {
  private readonly file: string | undefined;

  constructor(dir: string | undefined) {
    this.file = dir ? path.join(dir, "claude-limits.json") : undefined;
  }

  read(): StoredLimits | undefined {
    if (!this.file) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as StoredLimits;
      if (typeof parsed?.at !== "number" || !Array.isArray(parsed.limits)) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  write(value: StoredLimits): void {
    if (!this.file) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(value), "utf8");
    } catch {
      // Freshness is not worth surfacing an error over.
    }
  }
}
