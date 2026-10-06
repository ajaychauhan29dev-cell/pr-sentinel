export function formatPrice(cents, currency = "USD") {
  console.log("formatPrice", cents, currency);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
