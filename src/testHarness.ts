/**
 * A deliberately tiny test harness. This extension ships no runtime
 * dependencies and its logic under test is pure functions over data read from
 * disk, so pulling in a framework (and a config, and a transform pipeline)
 * would be more moving parts than the thing being tested.
 *
 * Suites register with `test()` at import time; `src/test-all.ts` imports each
 * suite and calls `report()`, which sets the exit code. Never imported by
 * `extension.ts`, so none of this reaches the bundle.
 */

interface Failure {
  suite: string;
  name: string;
  detail: string;
}

let currentSuite = "";
let checks = 0;
const failures: Failure[] = [];

export function suite(name: string): void {
  currentSuite = name;
}

export function test(name: string, fn: () => void): void {
  const owner = currentSuite;
  try {
    fn();
  } catch (err) {
    checks++;
    failures.push({
      suite: owner,
      name,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Strict equality on primitives, with the values printed on failure. */
export function eq<T>(actual: T, expected: T, what = ""): void {
  checks++;
  if (!Object.is(actual, expected)) {
    failures.push({
      suite: currentSuite,
      name: what || "eq",
      detail: `got ${fmt(actual)}, want ${fmt(expected)}`,
    });
  }
}

/** Equality within a tolerance, for money and other float math. */
export function close(actual: number, expected: number, what = "", epsilon = 1e-9): void {
  checks++;
  if (!(Math.abs(actual - expected) < epsilon)) {
    failures.push({
      suite: currentSuite,
      name: what || "close",
      detail: `got ${actual}, want ${expected} (+/- ${epsilon})`,
    });
  }
}

export function deepEq(actual: unknown, expected: unknown, what = ""): void {
  checks++;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures.push({ suite: currentSuite, name: what || "deepEq", detail: `got ${a}, want ${b}` });
  }
}

export function ok(value: unknown, what = ""): void {
  checks++;
  if (!value) {
    failures.push({ suite: currentSuite, name: what || "ok", detail: `got ${fmt(value)}, want truthy` });
  }
}

function fmt(v: unknown): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

/** Print results and exit non-zero if anything failed. */
export function report(): void {
  if (failures.length) {
    for (const f of failures) {
      console.log(`FAIL  [${f.suite}] ${f.name}\n        ${f.detail}`);
    }
    console.log(`\n${failures.length} of ${checks} checks FAILED`);
    process.exit(1);
  }
  console.log(`all ${checks} checks passed`);
  process.exit(0);
}
