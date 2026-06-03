import { formatGstin, getStateCode } from '@/services/gst'
import type { Invoice, Party, ShipDetails } from '@/types/models'

/** Resolve live party master by invoice party_id (for PDF/preview/display). */
export type PartyLookup = (partyId: string | null | undefined) => Partial<Party> | undefined

export function resolvePartyById(
  lookup: PartyLookup | undefined,
  partyId: string | null | undefined,
): Partial<Party> | undefined {
  if (!lookup || partyId == null) return undefined
  return lookup(partyId)
}

/** Buyer details for display: live party master overrides frozen snapshot (GST, address, etc.). */
export function resolveLivePartyDetails(
  inv: Invoice,
  liveParty?: Partial<Party> | null,
): Partial<Party> {
  const snap = inv.party_snapshot || {}
  if (!liveParty) {
    return { ...snap, gst: formatGstin(snap.gst) }
  }
  const gst = formatGstin(liveParty.gst || snap.gst)
  return {
    ...snap,
    addr: liveParty.addr ?? snap.addr,
    city: liveParty.city ?? snap.city,
    pin: liveParty.pin ?? snap.pin,
    email: liveParty.email ?? snap.email,
    phone: liveParty.phone ?? snap.phone,
    gst,
    state: liveParty.state ?? snap.state ?? getStateCode(gst) ?? getStateCode(snap.gst),
    is_consumer: liveParty.is_consumer ?? snap.is_consumer,
  }
}

/** Consignee ship block — uppercase GSTIN; refresh from live party when it matched buyer snapshot. */
export function resolveLiveShipDetails(
  inv: Invoice,
  liveParty?: Partial<Party> | null,
): ShipDetails | null | undefined {
  if (inv.sameAsBuyer !== false) return inv.ship
  const ship = inv.ship
  if (!ship) return ship

  const snapGst = formatGstin(inv.party_snapshot?.gst)
  const shipGst = formatGstin(ship.gstin)
  const liveGst = formatGstin(liveParty?.gst)
  const gstin = liveGst && (shipGst === snapGst || !shipGst) ? liveGst : shipGst

  return {
    ...ship,
    gstin,
    state: ship.state || getStateCode(gstin) || ship.state,
  }
}

export function displayGstinForInvoice(
  inv: Invoice,
  liveParty?: Partial<Party> | null,
): string {
  const details = resolveLivePartyDetails(inv, liveParty)
  if (details.is_consumer) return ''
  return formatGstin(details.gst) || formatGstin(inv.ship?.gstin)
}
