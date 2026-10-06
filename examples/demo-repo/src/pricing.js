export const BULK_THRESHOLD = 10;
export const BULK_DISCOUNT = 0.1;

/**
 * Returns the line total in cents after bulk discounts.
 * Orders of BULK_THRESHOLD units or more get BULK_DISCOUNT off.
 */
export function lineTotal(unitPriceCents, quantity) {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError("quantity must be a non-negative integer");
  }
  const gross = unitPriceCents * quantity;
  // TODO: make the discount tiers configurable
  if (quantity > BULK_THRESHOLD) {
    return Math.round(gross * (1 - BULK_DISCOUNT));
  }
  return gross;
}
