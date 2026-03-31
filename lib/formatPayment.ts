/**
 * Payment/balance display by viewer role.
 * DB stores REAL amount (e.g. 100).
 * - Teacher / Student panel: displayed = amount / 4
 * - Parent panel: displayed = amount (real)
 */
export type PaymentViewerRole = "teacher" | "student" | "parent";

/**
 * Returns the numeric value to display for a given amount and viewer role.
 */
export function formatPaymentAmount(
  amount: number,
  viewerRole: PaymentViewerRole
): number {
  if (viewerRole === "parent") return amount;
  return amount / 4;
}

/**
 * Returns a formatted string for UI display.
 * Max 2 decimals; if integer, no decimals (25 not 25.00).
 */
export function formatPaymentDisplay(
  amount: number,
  viewerRole: PaymentViewerRole
): string {
  const val = formatPaymentAmount(amount, viewerRole);
  return Number.isInteger(val) ? String(val) : val.toFixed(2);
}
