import { useFirmStore } from '@/stores/firm'
import { usePartyStore } from '@/stores/parties'
import { useItemStore } from '@/stores/items'
import { useInvoiceStore } from '@/stores/invoices'
import { usePurchaseStore } from '@/stores/purchases'
import { useRecipeStore } from '@/stores/recipes'
import { useAccountingStore } from '@/stores/accounting'
import { useProductionStore } from '@/stores/production'
import { useCapitalAssetStore } from '@/stores/assets'
import { usePayrollStore } from '@/stores/payroll'
import { usePartyAdvanceStore } from '@/stores/partyAdvances'

/** Reload all Dexie-backed stores after cloud pull. */
export async function reloadAllStores() {
  const firm = useFirmStore()
  await firm.load()
  await Promise.all([
    usePartyStore().load(),
    useItemStore().load(),
    useInvoiceStore().load(),
    usePurchaseStore().load(),
    useRecipeStore().load(),
    useAccountingStore().load(),
    useProductionStore().load(),
    useCapitalAssetStore().load(),
    usePayrollStore().load(),
    usePartyAdvanceStore().load(),
  ])
}
