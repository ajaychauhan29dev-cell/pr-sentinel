import { test } from "node:test";
import assert from "node:assert/strict";
import { cartTotal } from "../src/cart.js";

test("sums line totals", () => {
  assert.equal(
    cartTotal([
      { unitPriceCents: 500, quantity: 2 },
      { unitPriceCents: 250, quantity: 4 }
    ]),
    2000
  );
});

test("empty cart totals zero", () => {
  assert.equal(cartTotal([]), 0);
});
