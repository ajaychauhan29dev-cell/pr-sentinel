import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPrice } from "../src/format.js";

test("formats cents as USD", () => {
  assert.equal(formatPrice(123456), "$1,234.56");
});
