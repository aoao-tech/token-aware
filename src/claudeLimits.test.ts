/**
 * The usage endpoint is unofficial and has already changed shape once (the
 * top-level `five_hour`/`seven_day` buckets predate the structured `limits`
 * array, and both still arrive today). It also carries the credit spend, which
 * is real money. So the parsing is pinned against a captured live response
 * rather than an invented one.
 *
 * REAL_RESPONSE below is an actual body from
 * https://api.anthropic.com/api/oauth/usage, captured 2026-07-22 from a Max
 * account with usage credits enabled, trimmed only of null model buckets.
 */
import { parseUsageResponse } from "./claudeLimits";
import { close, deepEq, eq, ok, suite, test } from "./testHarness";

suite("claudeLimits");

const REAL_RESPONSE = {
  five_hour: {
    utilization: 56.0,
    resets_at: "2026-07-22T20:40:00.085307+00:00",
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day: {
    utilization: 16.0,
    resets_at: "2026-07-25T22:00:00.085332+00:00",
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day_opus: null,
  extra_usage: {
    is_enabled: true,
    monthly_limit: 2000,
    used_credits: 0.0,
    currency: "USD",
    decimal_places: 2,
  },
  limits: [
    {
      kind: "session",
      group: "session",
      percent: 56,
      severity: "normal",
      resets_at: "2026-07-22T20:40:00.085307+00:00",
      scope: null,
      is_active: true,
    },
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 16,
      severity: "normal",
      resets_at: "2026-07-25T22:00:00.085332+00:00",
      scope: null,
      is_active: false,
    },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 14,
      severity: "normal",
      resets_at: "2026-07-25T22:00:00.085588+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
      is_active: false,
    },
  ],
  spend: {
    used: { amount_minor: 0, currency: "USD", exponent: 2 },
    limit: { amount_minor: 2000, currency: "USD", exponent: 2 },
    percent: 0,
    severity: "normal",
    enabled: true,
    cap: { money: null, credits: { amount_minor: 2000, exponent: 2 } },
    balance: null,
    can_purchase_credits: false,
  },
  member_dashboard_available: false,
};

test("parses the live response into three labelled buckets", () => {
  const r = parseUsageResponse(REAL_RESPONSE as unknown as Record<string, unknown>);
  eq(r.error, undefined, "no error on a good response");
  eq(r.limits?.length, 3, "bucket count");
  deepEq(
    r.limits?.map((l) => [l.label, l.kind, l.pct]),
    [
      ["Session (5h)", "session", 56],
      ["Weekly (all models)", "weekly-all", 16],
      ["Weekly (Fable)", "weekly-model", 14],
    ],
    "labels, kinds and percentages"
  );
  eq(r.limits?.[0].resetsAt, Date.parse("2026-07-22T20:40:00.085307+00:00"), "reset time parsed");
});

test("reads credit spend as cents, including the cap", () => {
  const r = parseUsageResponse(REAL_RESPONSE as unknown as Record<string, unknown>);
  eq(r.credits?.usedCents, 0, "used");
  eq(r.credits?.limitCents, 2000, "the $20.00 monthly cap");
  eq(r.credits?.pct, 0, "percent of cap");
});

/**
 * The status bar only shows the session and weekly-all buckets, so a model
 * bucket mislabelled as one of those would put a wrong number on screen.
 */
test("a scoped bucket with no model name is not mistaken for a headline one", () => {
  const r = parseUsageResponse({
    limits: [{ kind: "weekly_scoped", percent: 30, scope: { model: null } }],
  });
  eq(r.limits?.[0].kind, "other", "kind");
  eq(r.limits?.[0].label, "Weekly Scoped", "label");
});

test("percentages are clamped to 0..100", () => {
  const over = parseUsageResponse({ limits: [{ kind: "session", percent: 140 }] });
  eq(over.limits?.[0].pct, 100, "over 100");
  const under = parseUsageResponse({ limits: [{ kind: "session", percent: -5 }] });
  eq(under.limits?.[0].pct, 0, "below 0");
});

test("falls back to the legacy bucket shape when there is no limits array", () => {
  const { limits: _drop, ...legacy } = REAL_RESPONSE as Record<string, unknown>;
  const r = parseUsageResponse(legacy);
  eq(r.error, undefined, "no error");
  deepEq(
    r.limits?.map((l) => [l.label, l.kind, l.pct]),
    [
      ["Session (5h)", "session", 56],
      ["Weekly (all models)", "weekly-all", 16],
    ],
    "legacy buckets still labelled"
  );
});

test("a legacy model bucket keeps its model name", () => {
  const r = parseUsageResponse({ seven_day_opus: { utilization: 42 } });
  eq(r.limits?.[0].label, "Weekly (Opus)", "label");
  eq(r.limits?.[0].kind, "weekly-model", "kind");
});

/**
 * Amounts arrive as minor units with an exponent. Assuming cents would be
 * wrong for any currency or payload that does not use two decimal places, and
 * being wrong here means misreporting money.
 */
test("normalizes minor units to cents by exponent", () => {
  const at = (exponent: number, amount_minor: number) =>
    parseUsageResponse({ spend: { enabled: true, used: { amount_minor, exponent } } }).credits?.usedCents;
  eq(at(2, 1234), 1234, "exponent 2 is already cents");
  eq(at(0, 5), 500, "exponent 0 is whole units");
  eq(at(3, 12345), 1235, "exponent 3 rounds to the nearest cent");
});

test("credit spend is absent, not zero, when the account has no credits", () => {
  eq(parseUsageResponse({ spend: { enabled: false, used: { amount_minor: 0, exponent: 2 } } }).credits, undefined, "disabled");
  eq(parseUsageResponse({}).credits, undefined, "missing entirely");
  eq(parseUsageResponse({ spend: { enabled: true } }).credits, undefined, "enabled but no amount");
});

test("a cap-less account reports spend without a limit", () => {
  const r = parseUsageResponse({ spend: { enabled: true, used: { amount_minor: 731, exponent: 2 } } });
  eq(r.credits?.usedCents, 731, "used");
  eq(r.credits?.limitCents, undefined, "no cap");
});

test("an unrecognizable response is an error, not empty gauges", () => {
  const r = parseUsageResponse({ something_else: true });
  ok(r.error, "reports an error");
  eq(r.limits, undefined, "no limits invented");
});

/**
 * Regression. Limits and credits are parsed independently, but the failure
 * return dropped the credits, so an account with real credit spend would lose
 * that figure entirely the next time this endpoint changed its limits shape,
 * which it has done before. Credit spend is the one number here that is actual
 * money, so it must survive an unrelated part of the payload moving.
 */
test("credit spend survives a limits shape this parser does not know", () => {
  const r = parseUsageResponse({
    some_future_limits_field: [{ kind: "session", pct_used: 56 }],
    spend: { enabled: true, used: { amount_minor: 431, exponent: 2 }, limit: { amount_minor: 2000, exponent: 2 } },
  });
  ok(r.error, "still reports the limits failure");
  eq(r.limits, undefined, "and invents no limits");
  eq(r.credits?.usedCents, 431, "but the money is still reported");
  eq(r.credits?.limitCents, 2000, "cap too");
});

test("malformed buckets are skipped rather than throwing", () => {
  const r = parseUsageResponse({
    limits: [
      { kind: "session", percent: "not a number" },
      { kind: "weekly_all", percent: 20 },
    ],
    five_hour: null,
  });
  eq(r.limits?.length, 1, "only the valid bucket survives");
  eq(r.limits?.[0].kind, "weekly-all", "and it is the right one");
});

test("an unparseable reset time is dropped, not left as NaN", () => {
  const r = parseUsageResponse({ limits: [{ kind: "session", percent: 10, resets_at: "whenever" }] });
  eq(r.limits?.[0].resetsAt, undefined, "resetsAt");
});

test("percent is optional on credit spend", () => {
  const r = parseUsageResponse({ spend: { enabled: true, used: { amount_minor: 100, exponent: 2 } } });
  eq(r.credits?.pct, undefined, "no percent reported");
  close(r.credits?.usedCents ?? -1, 100, "still reports the amount");
});
