export async function notifyFulfillment(order, send) {
  try {
    await send({ type: "order.created", orderId: order.id });
  } catch (err) {}
  return true;
}
