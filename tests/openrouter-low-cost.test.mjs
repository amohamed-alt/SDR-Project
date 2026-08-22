import assert from "node:assert/strict";
import test from "node:test";
import { estimateOpenRouterCostUsd } from "../src/lib/openrouter-low-cost.ts";

test("estimates GPT-4.1 Nano requests at the low-cost OpenRouter rate", () => {
  const cost = estimateOpenRouterCostUsd("openai/gpt-4.1-nano", 1_000, 220);
  assert.equal(cost, 0.000188);
});

test("estimates GPT-4.1 Mini at four times the Nano price for equal tokens", () => {
  const nano = estimateOpenRouterCostUsd("openai/gpt-4.1-nano", 2_000, 300);
  const mini = estimateOpenRouterCostUsd("openai/gpt-4.1-mini", 2_000, 300);
  assert.equal(Number((mini / nano).toFixed(2)), 4);
});

test("does not invent pricing for an unknown custom model", () => {
  const cost = estimateOpenRouterCostUsd("vendor/unknown-model", 10_000, 1_000);
  assert.equal(cost, 0);
});
