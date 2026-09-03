/** Decide how to reverse a recorded payment when clearing from bill / registry. */
export type PaymentClearAction = 'full_clear' | 'voucher_only' | 'none'

export function resolvePaymentClearAction(amtPaid: number, hasVoucher: boolean): PaymentClearAction {
  if ((Number(amtPaid) || 0) > 0.01) return 'full_clear'
  if (hasVoucher) return 'voucher_only'
  return 'none'
}
