import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { PlanLimit } from "./provider";
import { titleCase } from "./util";

const execFileAsync = promisify(execFile);

/**
 * The endpoint Claude Code's own /usage screen reads: plan-limit utilization
 * (5-hour session + weekly buckets) for subscription accounts. Unofficial,
 * so every failure path fails soft; genuine errors (network, HTTP, unexpected
 * shape) are still reported back so the UI can explain why gauges vanished,
 * rather than a silent, undiagnosable gap.
 */
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface ClaudeLimitsResult {
  limits?: PlanLimit[];
  /** Set only for unexpected failures; absence of credentials is not an error. */
  error?: string;
}

interface OAuthCreds {
  accessToken: string;
  expiresAt?: number;
}

/**
 * Read the local Claude Code OAuth token: from ~/.claude/.credentials.json
 * (Windows/Linux) or the login Keychain (macOS). Read-only, never stored.
 */
async function readOAuthCreds(): Promise<OAuthCreds | undefined> {
  let raw: string | undefined;
  try {
    raw = fs.readFileSync(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8");
  } catch {
    raw = undefined;
  }
  if (!raw && process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        { maxBuffer: 1024 * 1024 }
      );
      raw = stdout.trim();
    } catch {
      return undefined;
    }
  }
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const oauth = parsed.claudeAiOauth as Record<string, unknown> | undefined;
    if (typeof oauth?.accessToken === "string" && oauth.accessToken) {
      return {
        accessToken: oauth.accessToken,
        expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function legacyBucket(key: string): { label: string; kind: PlanLimit["kind"] } {
  if (key === "five_hour") {
    return { label: "Session (5h)", kind: "session" };
  }
  if (key === "seven_day") {
    return { label: "Weekly (all models)", kind: "weekly-all" };
  }
  const model = key.match(/^seven_day_(.+)$/);
  if (model) {
    return { label: `Weekly (${titleCase(model[1])})`, kind: "weekly-model" };
  }
  return { label: titleCase(key), kind: "other" };
}

/** Fetch plan-limit utilization. Absence of credentials is expected (API billing); other failures report why. */
export async function fetchClaudeLimits(): Promise<ClaudeLimitsResult> {
  const creds = await readOAuthCreds();
  if (!creds) {
    return {};
  }
  // Credentials exist but have lapsed. Claude Code refreshes on next use, so
  // this is usually momentary, but say so rather than dropping the gauges
  // with no explanation.
  if (creds.expiresAt && creds.expiresAt <= Date.now()) {
    return { error: "Claude Code sign-in expired; refreshes on next use" };
  }

  let data: Record<string, unknown>;
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      return { error: `usage endpoint returned HTTP ${res.status}` };
    }
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return { error: `usage request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Preferred: the structured `limits` array (includes model-scoped buckets).
  const structured = parseStructuredLimits(data.limits);
  if (structured.length) {
    return { limits: structured };
  }

  // Fallback for older response shapes: top-level utilization buckets.
  const limits: PlanLimit[] = [];
  for (const [key, value] of Object.entries(data)) {
    const bucket = value as Record<string, unknown> | null;
    if (!bucket || typeof bucket !== "object" || typeof bucket.utilization !== "number") {
      continue;
    }
    const resetsAt = typeof bucket.resets_at === "string" ? Date.parse(bucket.resets_at) : NaN;
    const { label, kind } = legacyBucket(key);
    limits.push({
      label,
      kind,
      pct: Math.max(0, Math.min(100, bucket.utilization)),
      resetsAt: Number.isNaN(resetsAt) ? undefined : resetsAt,
    });
  }
  return limits.length ? { limits } : { error: "usage response had no recognizable limit buckets" };
}

function parseStructuredLimits(raw: unknown): PlanLimit[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const limits: PlanLimit[] = [];
  for (const item of raw) {
    const l = item as Record<string, unknown>;
    if (typeof l.percent !== "number") {
      continue;
    }
    const scope = l.scope as Record<string, unknown> | null | undefined;
    const model = scope?.model as Record<string, unknown> | null | undefined;
    const modelName = typeof model?.display_name === "string" ? model.display_name : undefined;
    const rawKind = typeof l.kind === "string" ? l.kind : "";
    let label: string;
    let kind: PlanLimit["kind"];
    if (rawKind === "session") {
      label = "Session (5h)";
      kind = "session";
    } else if (rawKind === "weekly_all") {
      label = "Weekly (all models)";
      kind = "weekly-all";
    } else if (rawKind === "weekly_scoped" && modelName) {
      label = `Weekly (${modelName})`;
      kind = "weekly-model";
    } else {
      label = modelName ? `${titleCase(rawKind)} (${modelName})` : titleCase(rawKind);
      kind = "other";
    }
    const resetsAt = typeof l.resets_at === "string" ? Date.parse(l.resets_at) : NaN;
    limits.push({
      label,
      kind,
      pct: Math.max(0, Math.min(100, l.percent)),
      resetsAt: Number.isNaN(resetsAt) ? undefined : resetsAt,
    });
  }
  return limits;
}
