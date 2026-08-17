const STRIPE_GBP_MINIMUM_CHARGE_CENTS = 30;

function calculateCreditRedemption(subtotalCentsValue, creditBalance, currency = "GBP") {
  const subtotalCents = Math.max(0, Math.round(Number(subtotalCentsValue) || 0));
  const availableCreditCents = String(currency || "GBP").toUpperCase() === "GBP"
    ? Math.max(0, Math.round((Number(creditBalance) || 0) * 100))
    : 0;
  let creditAppliedCents = Math.min(subtotalCents, availableCreditCents);
  let amountCents = subtotalCents - creditAppliedCents;

  // Keep a partial card payment above Stripe's minimum. The unused pennies
  // remain in the member's balance and can be applied to a later order.
  if (amountCents > 0 && amountCents < STRIPE_GBP_MINIMUM_CHARGE_CENTS) {
    creditAppliedCents = Math.max(0, subtotalCents - STRIPE_GBP_MINIMUM_CHARGE_CENTS);
    amountCents = subtotalCents - creditAppliedCents;
  }

  return { availableCreditCents, creditAppliedCents, amountCents };
}

module.exports = {
  STRIPE_GBP_MINIMUM_CHARGE_CENTS,
  calculateCreditRedemption
};
