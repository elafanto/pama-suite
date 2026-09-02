/** Legacy bills (field unset) still affect stock; new bills need explicit opt-in. */
export function billUpdatesStock(doc: { update_stock?: boolean }): boolean {
  if (doc.update_stock === false) return false
  return true
}
