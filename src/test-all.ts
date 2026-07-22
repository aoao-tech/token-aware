/**
 * Test entry point. Each suite registers its checks at import time; `report()`
 * prints the results and sets the exit code.
 *
 * Add a new suite by importing it here. Suites are ordered cheapest first so a
 * broken formatter is reported before a directory of temp-file tests runs.
 */
import "./util.test";
import "./agents.test";
import "./claudePricing.test";
import "./claudeLimits.test";
import "./limitsStore.test";
import { report } from "./testHarness";

report();
