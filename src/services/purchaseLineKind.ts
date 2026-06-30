import type { ExpenseCategory, PurchaseItemLine, PurchaseLineKind } from '@/types/models'

export type { ExpenseCategory, PurchaseLineKind } from '@/types/models'

export const PURCHASE_LINE_KIND_OPTIONS: {
  kind: PurchaseLineKind
  label: string
  hint: string
}[] = [
  { kind: 'inventory', label: 'Inventory', hint: 'Consumable stock' },
  { kind: 'reel', label: 'Paper Reel', hint: 'Reel register' },
  { kind: 'consumable', label: 'Consumable', hint: 'Glue, ink, wire' },
  { kind: 'capital', label: 'Capital Asset', hint: 'Machinery, furniture' },
  { kind: 'expense', label: 'Expense', hint: 'Building, electricity…' },
]

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  building_material: 'Building Material',
  utilities: 'Utilities / Electricity',
  repairs: 'Repairs & Maintenance',
  freight: 'Freight / Transport',
  professional: 'Professional / Legal',
  other: 'Other Expense',
}

export function getLineKind(line: PurchaseItemLine): PurchaseLineKind {
  if (line.line_kind) return line.line_kind
  if (line.is_kraft_reel) return 'reel'
  if (line.is_consumable) return 'consumable'
  if (line.is_capital) return 'capital'
  if (line.is_expense) return 'expense'
  return 'inventory'
}

export function applyLineKind(line: PurchaseItemLine, kind: PurchaseLineKind) {
  line.line_kind = kind
  line.is_kraft_reel = kind === 'reel'
  line.is_consumable = kind === 'consumable'
  line.is_capital = kind === 'capital'
  line.is_expense = kind === 'expense'

  if (kind === 'reel') {
    line.unit = line.unit || 'KG'
    line.reel_weight = line.reel_weight || line.qty || 0
    line.hsn = line.hsn || '48043100'
    line.paper_type = line.paper_type || 'KRAFT'
  }
  if (kind === 'consumable') {
    line.unit = line.unit || 'KG'
    line.consumable_type = line.consumable_type || 'glue'
  }
  if (kind === 'capital') {
    line.unit = line.unit || 'NOS'
    line.capital_category = line.capital_category || 'plant_machinery'
  }
  if (kind === 'expense') {
    line.expense_category = line.expense_category || 'other'
  }
}

export function normalizePurchaseLine(line: PurchaseItemLine): PurchaseItemLine {
  applyLineKind(line, getLineKind(line))
  return line
}

/** Only inventory lines enter consumable item stock. */
export function isGenericInventoryLine(line: PurchaseItemLine): boolean {
  return getLineKind(line) === 'inventory'
}
