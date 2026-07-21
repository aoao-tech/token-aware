import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProviderUnit } from "./provider";
import { titleCase } from "./util";

export interface ClaudePlan {
  /** Display unit implied by the billing model. */
  unit: ProviderUnit;
  /** Human-readable plan name, e.g. "Max", "Pro", "API billing". */
  label?: string;
}

/**
 * Detect how the local Claude Code login is billed:
 * subscription plans (flat monthly fee) -> "tokens", API billing -> "dollars".
 *
 * Signals, in order of reliability:
 * 1. ~/.claude/.credentials.json -> claudeAiOauth.subscriptionType
 *    (present on Windows/Linux; macOS stores tokens in the Keychain instead).
 * 2. ~/.claude.json -> oauthAccount.billingType (all platforms).
 * 3. An oauthAccount at all means a claude.ai login (plan-based); its absence
 *    alongside existing Claude data suggests API-key billing.
 *
 * Returns undefined when nothing conclusive is found.
 */
export function detectClaudePlan(): ClaudePlan | undefined {
  const home = os.homedir();

  const creds = readJson(path.join(home, ".claude", ".credentials.json"));
  const oauth = creds?.claudeAiOauth as Record<string, unknown> | undefined;
  const subscription = typeof oauth?.subscriptionType === "string" ? oauth.subscriptionType : "";
  if (subscription) {
    return { unit: "tokens", label: titleCase(subscription) };
  }

  const config = readJson(path.join(home, ".claude.json"));
  if (!config) {
    return undefined;
  }
  const account = config.oauthAccount as Record<string, unknown> | undefined;
  if (account) {
    const billing = typeof account.billingType === "string" ? account.billingType : "";
    if (billing === "" || billing.includes("subscription")) {
      return { unit: "tokens", label: "Subscription" };
    }
    return { unit: "dollars", label: titleCase(billing) };
  }
  // Config exists but no claude.ai login: likely an API key setup.
  return { unit: "dollars", label: "API billing" };
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
