/**
 * Grouping decides which session is called "current" and what each row of the
 * details panel says. Titles come from transcript content, so truncation and
 * extraction have to cope with whatever a user typed.
 */
import { aggregateModels, extractText, groupAgents, shortId, truncate } from "./agents";
import { UsageEvent } from "./types";
import { deepEq, eq, ok, suite, test } from "./testHarness";

suite("agents");

function event(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    timestamp: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    ...over,
  };
}

test("sums each conversation and orders by most recent activity", () => {
  const agents = groupAgents(
    [
      event({ conversationId: "a", timestamp: 100, inputTokens: 10, costCents: 5 }),
      event({ conversationId: "b", timestamp: 300, inputTokens: 20, costCents: 7 }),
      event({ conversationId: "a", timestamp: 200, inputTokens: 30, costCents: 9 }),
    ],
    undefined
  );
  deepEq(agents.map((a) => a.conversationId), ["b", "a"], "most recent first");
  const a = agents.find((x) => x.conversationId === "a");
  eq(a?.tokens, 40, "tokens summed");
  eq(a?.costCents, 14, "cost summed");
  eq(a?.count, 2, "call count");
  eq(a?.lastTs, 200, "latest timestamp wins");
});

test("marks exactly the current conversation", () => {
  const agents = groupAgents(
    [event({ conversationId: "a", timestamp: 1 }), event({ conversationId: "b", timestamp: 2 })],
    "a"
  );
  eq(agents.filter((x) => x.isCurrent).length, 1, "one current");
  eq(agents.find((x) => x.isCurrent)?.conversationId, "a", "and it is the right one");
});

test("a current id that is not present marks nothing, rather than guessing", () => {
  const agents = groupAgents([event({ conversationId: "a", timestamp: 1 })], "missing");
  eq(agents.filter((x) => x.isCurrent).length, 0, "none marked");
});

test("events with no conversation are dropped", () => {
  eq(groupAgents([event({ timestamp: 1 })], undefined).length, 0, "no phantom rows");
});

test("the three cost buckets are kept apart while summing", () => {
  const agents = groupAgents(
    [
      event({ conversationId: "a", costCents: 100, setupCostCents: 60, reusedCostCents: 30 }),
      event({ conversationId: "a", costCents: 10, setupCostCents: 4, reusedCostCents: 3 }),
    ],
    undefined
  );
  eq(agents[0].costCents, 110, "total");
  eq(agents[0].setupCostCents, 64, "loading context");
  eq(agents[0].reusedCostCents, 33, "re-reading context");
});

test("aggregates by model, largest first", () => {
  const models = aggregateModels([
    event({ model: "claude-fable-5", inputTokens: 100, costCents: 10 }),
    event({ model: "claude-opus-4-8", inputTokens: 500, costCents: 20 }),
    event({ model: "claude-fable-5", inputTokens: 50, costCents: 5 }),
  ]);
  deepEq(models.map((m) => m.model), ["claude-opus-4-8", "claude-fable-5"], "ordered by tokens");
  eq(models[1].totalTokens, 150, "fable tokens summed");
  eq(models[1].costCents, 15, "fable cost summed");
});

test("a call with no model is labelled rather than dropped", () => {
  const models = aggregateModels([event({ inputTokens: 5 })]);
  eq(models[0].model, "unknown", "label");
  eq(models[0].totalTokens, 5, "still counted");
});

test("truncate backs up to a word boundary and marks the cut", () => {
  eq(truncate("short", 48), "short", "under the limit is untouched");
  const long = truncate("the quick brown fox jumps over the lazy dog and keeps running", 20);
  ok(long.endsWith("…"), "ends with an ellipsis");
  ok(long.length <= 20, "respects the limit");
  ok(!long.includes("jumps over"), "cut before the limit");
});

test("truncate does not strand a long unbroken word", () => {
  // No space late enough to back up to, so it cuts mid-word rather than
  // returning almost nothing.
  const out = truncate("a".repeat(60), 20);
  ok(out.endsWith("…"), "still marked");
  ok(out.length >= 15, "not collapsed to a stub");
});

test("extractText digs a string out of the shapes a transcript uses", () => {
  eq(extractText("plain"), "plain", "bare string");
  eq(extractText({ text: "in text" }), "in text", "text field");
  eq(extractText({ content: "in content" }), "in content", "content field");
  eq(extractText([{ text: "first" }, { text: "second" }]), "first", "first match in an array");
  eq(extractText([{}, { text: "later" }]), "later", "skips empty entries");
  eq(extractText({ content: [{ type: "text", text: "nested" }] }), "nested", "nested content blocks");
  eq(extractText(undefined), undefined, "nothing to find");
  eq(extractText({ other: 1 }), undefined, "no text anywhere");
});

test("shortId is stable and short", () => {
  eq(shortId("88fe05cd-2d70-41f6-8c65-f1797ecfdb64"), "88fe05cd", "first segment");
});
