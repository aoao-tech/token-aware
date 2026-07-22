/**
 * This store is shared across every open window, so a bad read or write shows
 * up as gauges flickering or a credit figure vanishing, which is precisely the
 * bug fixed in 0.2.26. Its contract is: never throw, and never lose a field
 * that a later read depends on.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LimitsStore } from "./limitsStore";
import { PlanLimit } from "./provider";
import { eq, ok, suite, test } from "./testHarness";

suite("limitsStore");

let dirCounter = 0;
/** A fresh scratch dir per test, so no test can see another's file. */
function tempDir(): string {
  const dir = path.join(os.tmpdir(), `token-aware-test-${process.pid}-${dirCounter++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const LIMITS: PlanLimit[] = [
  { label: "Session (5h)", kind: "session", pct: 56, resetsAt: 1_784_000_000_000 },
  { label: "Weekly (all models)", kind: "weekly-all", pct: 16 },
];

test("round-trips limits and credits", () => {
  const store = new LimitsStore(tempDir());
  store.write({ at: 1000, limits: LIMITS, credits: { usedCents: 250, limitCents: 2000, pct: 12.5 } });
  const read = store.read();
  eq(read?.at, 1000, "timestamp");
  eq(read?.limits.length, 2, "limit count");
  eq(read?.limits[0].pct, 56, "percentage");
  eq(read?.limits[0].resetsAt, 1_784_000_000_000, "reset time");
  eq(read?.credits?.usedCents, 250, "credits used");
  eq(read?.credits?.limitCents, 2000, "credit cap");
  eq(read?.credits?.pct, 12.5, "credit percentage");
});

/**
 * The 0.2.26 bug: a rate-limited lookup rewrote the file with limits but no
 * credits, so the credit figure disappeared until the next successful call.
 * The store must be able to carry credits alongside a retry deadline.
 */
test("keeps credits when storing a retry deadline", () => {
  const store = new LimitsStore(tempDir());
  store.write({ at: 0, limits: LIMITS, credits: { usedCents: 999 }, retryUntil: 5000 });
  const read = store.read();
  eq(read?.retryUntil, 5000, "retry deadline");
  eq(read?.credits?.usedCents, 999, "credits survive alongside it");
});

test("a missing file reads as undefined, not an error", () => {
  eq(new LimitsStore(tempDir()).read(), undefined, "read");
});

test("a corrupt file reads as undefined rather than throwing", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "claude-limits.json"), "{not json", "utf8");
  eq(new LimitsStore(dir).read(), undefined, "read");
});

test("a well-formed file with the wrong shape is rejected", () => {
  const dir = tempDir();
  const store = new LimitsStore(dir);
  const file = path.join(dir, "claude-limits.json");
  fs.writeFileSync(file, JSON.stringify({ at: "yesterday", limits: [] }), "utf8");
  eq(store.read(), undefined, "non-numeric timestamp");
  fs.writeFileSync(file, JSON.stringify({ at: 1, limits: "none" }), "utf8");
  eq(store.read(), undefined, "limits not an array");
  fs.writeFileSync(file, JSON.stringify({ limits: [] }), "utf8");
  eq(store.read(), undefined, "timestamp missing");
});

/**
 * An empty limits array is meaningfully different from a corrupt file: it is
 * how a window records "I was told to wait" so its siblings do not also go and
 * earn a 429. It has to survive the round trip.
 */
test("an empty limits array is preserved, not treated as corrupt", () => {
  const store = new LimitsStore(tempDir());
  store.write({ at: 0, limits: [], retryUntil: 9999 });
  const read = store.read();
  ok(read, "reads back");
  eq(read?.limits.length, 0, "still empty");
  eq(read?.retryUntil, 9999, "deadline kept");
});

test("a later write replaces the earlier one", () => {
  const store = new LimitsStore(tempDir());
  store.write({ at: 1, limits: LIMITS });
  store.write({ at: 2, limits: [{ label: "Session (5h)", kind: "session", pct: 90 }] });
  const read = store.read();
  eq(read?.at, 2, "timestamp");
  eq(read?.limits.length, 1, "limit count");
  eq(read?.limits[0].pct, 90, "percentage");
});

test("two stores on one directory see each other, as separate windows must", () => {
  const dir = tempDir();
  new LimitsStore(dir).write({ at: 42, limits: LIMITS, credits: { usedCents: 7 } });
  const other = new LimitsStore(dir).read();
  eq(other?.at, 42, "timestamp");
  eq(other?.credits?.usedCents, 7, "credits");
});

test("no storage directory disables the store without throwing", () => {
  const store = new LimitsStore(undefined);
  store.write({ at: 1, limits: LIMITS });
  eq(store.read(), undefined, "read");
});

test("writes create the directory if it does not exist yet", () => {
  const dir = path.join(tempDir(), "nested", "deeper");
  const store = new LimitsStore(dir);
  store.write({ at: 5, limits: LIMITS });
  eq(store.read()?.at, 5, "read back through a created path");
});

test("an unwritable path fails soft: freshness lost, feature intact", () => {
  const dir = tempDir();
  // A file where the directory should be makes mkdir/write fail.
  fs.writeFileSync(path.join(dir, "blocked"), "", "utf8");
  const store = new LimitsStore(path.join(dir, "blocked"));
  store.write({ at: 1, limits: LIMITS });
  eq(store.read(), undefined, "read returns nothing rather than throwing");
});
