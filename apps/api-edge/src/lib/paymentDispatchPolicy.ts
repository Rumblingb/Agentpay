export function shouldDispatchPaidAction(input: {
  requiresPayment: boolean;
  paymentConfirmed: boolean;
}): boolean {
  return !input.requiresPayment || input.paymentConfirmed;
}
