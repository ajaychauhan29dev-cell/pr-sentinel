import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTotal } from "../src/pricing.js";

test("no discount below the bulk threshold", () => {
  assert.equal(lineTotal(1000, 9), 9000);
});

test("bulk discount applies at exactly the threshold", () => {
  assert.equal(lineTotal(1000, 10), 9000);
});

test("bulk discount applies above the threshold", () => {
  assert.equal(lineTotal(1000, 20), 18000);
});

test("rejects negative quantities", () => {
  assert.throws(() => lineTotal(1000, -1), RangeError);
});
