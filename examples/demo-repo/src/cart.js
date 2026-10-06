import { lineTotal } from "./pricing.js";

export function cartTotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item.unitPriceCents, item.quantity), 0);
}
