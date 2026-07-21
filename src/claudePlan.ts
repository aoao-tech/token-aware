import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProviderUnit } from "./provider";
import { titleCase } from "./util";

export interface ClaudePlan {
  /** Display unit implied by the billing model. */
  unit: ProviderUnit;
  /** Human-readable plan name, e.g. "Max", "Enterprise", "API billing". */
  label?: string;
}

/** Individual plan tiers known to be a flat monthly fee, not metered usage. */
const FLAT_FEE_TIERS = new Set(["free", "pro", "max"]);

/**
 * Detect how the local Claude Code login is billed: flat monthly plans
 * (Free/Pro/Max) -> "tokens", metered usage -> "dollars".
 *
 * Crucially, a claude.ai login is NOT itself evidence of flat-fee billing:
 * Team and Enterprise seats sign in the exact same way via corporate SSO
 * (no API key ever entered) but are commonly billed per-usage under the
 * org's contract. So an unrecognized or organizational plan name defaults
 * to "dollars" rather than assuming it's a personal flat-fee plan.
 *
 * Signals, in order of reliability:
 * 1. ~/.claude.json -> oauthAccount.billingType, the most direct signal
 *    (present on all platforms once a claude.ai login exists).
 * 2. ~/.claude/.credentials.json -> claudeAiOauth.subscriptionType, to name
 *    the plan (present on Windows/Linux; macOS stores tokens in the Keychain
 *    instead, so this is unavailable there).
 * 3. An oauthAccount at all means a claude.ai login; its absence alongside
 *    existing Claude data suggests a bare API key setup.
 *
 * Returns undefined when nothing conclusive is found.
 */
export function detectClaudePlan(): ClaudePlan | undefined {
  const home = os.homedir();

  const creds = readJson(path.join(home, ".claude", ".credentials.json"));
  const oauth = creds?.claudeAiOauth as Record<string, unknown> | undefined;
  const subscription = typeof oauth?.subscriptionType === "string" ? oauth.subscriptionType : "";
  const planLabel = subscription ? titleCase(subscription) : undefined;

  const config = readJson(path.join(home, ".claude.json"));
  const account = config?.oauthAccount as Record<string, unknown> | undefined;
  const billingType = typeof account?.billingType === "string" ? account.billingType : "";

  if (billingType) {
    return billingType.includes("subscription")
      ? { unit: "tokens", label: planLabel ?? "Subscription" }
      : { unit: "dollars", label: planLabel ?? titleCase(billingType) };
  }

  if (subscription) {
    return FLAT_FEE_TIERS.has(subscription.toLowerCase())
      ? { unit: "tokens", label: planLabel }
      : { unit: "dollars", label: planLabel };
  }
  if (account) {
    // Logged in to claude.ai but no billing signal at all: an org seat of
    // some kind. Default to dollars; override with the unit setting if wrong.
    return { unit: "dollars", label: "Enterprise" };
  }
  if (!config) {
    return undefined;
  }
  // Config exists but no claude.ai login at all: likely a bare API key setup.
  return { unit: "dollars", label: "API billing" };
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
