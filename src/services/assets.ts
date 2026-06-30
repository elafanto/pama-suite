import { db } from '@/data/db'
import { uid, nowISO } from '@/data/util'
import type { CapitalAsset, CapitalCategory, Purchase, PurchaseItemLine } from '@/types/models'

const plain = <X>(o: X): X => JSON.parse(JSON.stringify(o))

export const CAPITAL_CATEGORY_LABELS: Record<CapitalCategory, string> = {
  plant_machinery: 'Plant & Machinery',
  furniture: 'Furniture & Fixtures',
  vehicle: 'Vehicle',
  computer: 'Computer & IT',
  other: 'Other Capital',
}

/** Lines that should not enter consumable item stock. Paper reels use their own register. */
export function isGenericInventoryLine(line: PurchaseItemLine): boolean {
  return !line.is_kraft_reel && !line.is_consumable && !line.is_capital
}

function assetFromLine(purchase: Purchase, line: PurchaseItemLine, lineIndex: number): Omit<CapitalAsset, 'id' | 'created_at' | 'updated_at' | 'is_deleted' | '_dirty'> {
  const qty = Number(line.qty) || 0
  const rate = Number(line.rate) || 0
  return {
    firm_id: purchase.firm_id,
    name: line.name.trim(),
    item_id: line.item_id,
    category: line.capital_category || 'plant_machinery',
    asset_tag: line.asset_tag?.trim() || undefined,
    supplier_id: purchase.supplier_id,
    supplier_name: purchase.supplier_name,
    purchase_id: purchase.id,
    purchase_bill_no: purchase.bill_no,
    purchase_line_index: lineIndex,
    purchase_date: purchase.received_date || purchase.date,
    qty,
    unit: line.unit || 'NOS',
    rate,
    amount: Math.round(qty * rate * 100) / 100,
    hsn: line.hsn,
    status: 'active',
    notes: `Capital asset from purchase ${purchase.bill_no}`,
  }
}

export async function createCapitalAssetsFromPurchase(purchase: Purchase) {
  const rows = (purchase.items || [])
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ line }) => line.is_capital && line.name.trim())

  const existing = await db.capital_assets
    .where('purchase_id')
    .equals(purchase.id)
    .toArray()
    .catch(() => [])
  const existingByIndex = new Map(existing.map((asset) => [asset.purchase_line_index, asset]))
  const usedIds = new Set<string>()
  const now = nowISO()
  let count = 0

  await db.transaction('rw', db.capital_assets, async () => {
    for (const { line, lineIndex } of rows) {
      const matched = existingByIndex.get(lineIndex)
      const payload = assetFromLine(purchase, line, lineIndex)
      if (matched) {
        usedIds.add(matched.id)
        await db.capital_assets.put(plain({
          ...matched,
          ...payload,
          status: matched.status === 'active' ? 'active' : matched.status,
          updated_at: now,
          is_deleted: false,
          _dirty: true,
        }))
      } else {
        await db.capital_assets.add(plain({
          ...payload,
          id: uid(),
          created_at: now,
          updated_at: now,
          is_deleted: false,
          _dirty: true,
        }) as CapitalAsset)
      }
      count++
    }

    for (const asset of existing) {
      if (!usedIds.has(asset.id) && !asset.is_deleted) {
        await db.capital_assets.put({ ...asset, is_deleted: true, updated_at: now, _dirty: true })
      }
    }
  })

  return count
}

export async function reversePurchaseCapitalAssets(purchaseId: string) {
  const assets = await db.capital_assets.where('purchase_id').equals(purchaseId).toArray()
  const now = nowISO()
  for (const asset of assets) {
    if (!asset.is_deleted) {
      await db.capital_assets.put({ ...asset, is_deleted: true, updated_at: now, _dirty: true })
    }
  }
}

export async function listCapitalAssets(firmId: string): Promise<CapitalAsset[]> {
  return db.capital_assets
    .where('firm_id')
    .equals(firmId)
    .filter((a) => !a.is_deleted)
    .toArray()
    .then((rows) => rows.sort((a, b) => (b.purchase_date || '').localeCompare(a.purchase_date || '') || a.name.localeCompare(b.name)))
}

export async function updateCapitalAssetStatus(assetId: string, status: CapitalAsset['status']) {
  const asset = await db.capital_assets.get(assetId)
  if (!asset || asset.is_deleted) throw new Error('Capital asset not found')
  const now = nowISO()
  await db.capital_assets.put({ ...asset, status, updated_at: now, _dirty: true })
}
