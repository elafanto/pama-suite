<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useFirmStore } from '@/stores/firm'
import {
  STOCK_SEGMENT_LABELS,
  STOCK_SEGMENTS,
  createBlankStockStatement,
  grandTotal,
  listStockStatements,
  newPaperLine,
  newSimpleLine,
  saveStockStatement,
  segmentTotal,
  softDeleteStockStatement,
} from '@/services/stockStatement'
import { downloadStockStatementPdf } from '@/services/stockStatementPdf'
import type { StockStatement, StockStatementLine, StockStatementSegment } from '@/types/models'

const firm = useFirmStore()
const loading = ref(true)
const saving = ref(false)
const status = ref('')
const savedStatements = ref<StockStatement[]>([])
const form = ref<StockStatement | null>(null)

const rowsBySegment = computed<Record<StockStatementSegment, StockStatementLine[]>>(() => ({
  paper: (form.value?.lines || []).filter((line) => line.segment === 'paper'),
  gum: (form.value?.lines || []).filter((line) => line.segment === 'gum'),
  stitching_wire: (form.value?.lines || []).filter((line) => line.segment === 'stitching_wire'),
  consumables: (form.value?.lines || []).filter((line) => line.segment === 'consumables'),
}))

function n2(v: number) {
  return (v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function lineLabel(segment: StockStatementSegment) {
  return segment === 'paper' ? 'Paper name' : 'Item name'
}

function ensureForm() {
  if (!form.value) form.value = createBlankStockStatement(firm.activeFirmId)
  return form.value
}

function recalcLine(line: StockStatementLine) {
  line.qty = Number(line.qty) || 0
  line.rate = Number(line.rate) || 0
  line.amount = Math.round(line.qty * line.rate * 100) / 100
}

function addRow(segment: StockStatementSegment) {
  const current = ensureForm()
  current.lines.push(segment === 'paper' ? newPaperLine() : newSimpleLine(segment))
}

function removeRow(lineId: string) {
  const current = ensureForm()
  current.lines = current.lines.filter((line) => line.id !== lineId)
}

async function reloadSaved() {
  savedStatements.value = await listStockStatements(firm.activeFirmId)
}

function newStatement() {
  status.value = ''
  form.value = createBlankStockStatement(firm.activeFirmId)
}

function editStatement(statement: StockStatement) {
  status.value = ''
  form.value = JSON.parse(JSON.stringify(statement))
}

async function saveCurrent() {
  const current = ensureForm()
  if (!current.statement_date) {
    status.value = 'Statement date required'
    return
  }
  saving.value = true
  status.value = ''
  try {
    form.value = await saveStockStatement(current)
    await reloadSaved()
    status.value = 'Stock statement saved.'
  } catch (err: any) {
    status.value = err?.message || 'Save failed'
  } finally {
    saving.value = false
  }
}

async function deleteCurrent(statement: StockStatement) {
  if (!confirm(`Delete stock statement ${statement.statement_no}?`)) return
  await softDeleteStockStatement(statement.id)
  await reloadSaved()
  if (form.value?.id === statement.id) newStatement()
}

function printStatement() {
  window.print()
}

function downloadPdf() {
  const current = ensureForm()
  downloadStockStatementPdf(current, firm.activeFirm)
}

onMounted(async () => {
  loading.value = true
  await firm.load()
  await reloadSaved()
  newStatement()
  loading.value = false
})
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <header class="flex items-center justify-between gap-3 mb-5 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-navy">Stock Statement</h1>
        <p class="text-sm text-slate-500">Bank ke liye manual stock statement: Paper, Gum, Stitching Wire, Consumables.</p>
      </div>
      <div class="flex gap-2 hide-on-print">
        <button class="pp-btn pp-btn-ghost" @click="newStatement">New</button>
        <button class="pp-btn pp-btn-primary" :disabled="saving" @click="saveCurrent">{{ saving ? 'Saving...' : 'Save' }}</button>
        <button class="pp-btn pp-btn-ghost" @click="downloadPdf">Download PDF</button>
        <button class="pp-btn pp-btn-ghost" @click="printStatement">Print</button>
      </div>
    </header>

    <div v-if="loading" class="pp-card p-10 text-center text-slate-400">Loading...</div>
    <div v-else class="grid grid-cols-1 xl:grid-cols-[18rem_1fr] gap-5">
      <aside class="pp-card p-4 hide-on-print h-fit">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold text-navy">Saved Statements</h2>
          <span class="text-xs text-slate-400">{{ savedStatements.length }}</span>
        </div>
        <div v-if="savedStatements.length === 0" class="text-sm text-slate-400">No saved statements yet.</div>
        <div v-else class="space-y-2">
          <button
            v-for="statement in savedStatements"
            :key="statement.id"
            type="button"
            class="w-full text-left rounded-lg border p-3 hover:bg-slate-50"
            :class="form?.id === statement.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200'"
            @click="editStatement(statement)"
          >
            <div class="font-semibold text-navy">{{ statement.statement_no || 'Draft' }}</div>
            <div class="text-xs text-slate-500">{{ statement.statement_date }} · {{ statement.bank_name || 'Bank not set' }}</div>
            <div class="text-xs text-slate-500 mt-1">Total: Rs. {{ n2(grandTotal(statement.lines || [])) }}</div>
            <div class="mt-2">
              <button class="text-xs text-rose-600 underline" @click.stop="deleteCurrent(statement)">Delete</button>
            </div>
          </button>
        </div>
      </aside>

      <section v-if="form" class="space-y-4">
        <div class="pp-card p-4">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div>
              <label class="pp-label">Statement No</label>
              <input v-model="form.statement_no" class="pp-input" placeholder="SS-20260630" />
            </div>
            <div>
              <label class="pp-label">Statement Date</label>
              <input v-model="form.statement_date" type="date" class="pp-input" />
            </div>
            <div>
              <label class="pp-label">Bank Name</label>
              <input v-model="form.bank_name" class="pp-input" placeholder="Bank name" />
            </div>
            <div>
              <label class="pp-label">Branch</label>
              <input v-model="form.branch_name" class="pp-input" placeholder="Branch name" />
            </div>
          </div>
          <div class="mt-3">
            <label class="pp-label">Remarks</label>
            <textarea v-model="form.remarks" class="pp-input min-h-[70px]" placeholder="Optional notes for bank statement"></textarea>
          </div>
          <p v-if="status" class="mt-2 text-sm text-blue-700">{{ status }}</p>
        </div>

        <div v-for="segment in STOCK_SEGMENTS" :key="segment" class="pp-card p-4 overflow-hidden">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 class="font-bold text-navy">{{ STOCK_SEGMENT_LABELS[segment] }}</h2>
              <p class="text-xs text-slate-500">
                <template v-if="segment === 'paper'">Paper me BF, GSM, Qty aur Rate bharo.</template>
                <template v-else>Normal item name, qty, unit aur rate bharo.</template>
              </p>
            </div>
            <button type="button" class="pp-btn pp-btn-ghost hide-on-print" @click="addRow(segment)">+ Add Row</button>
          </div>

          <div class="overflow-x-auto -mx-4 px-4">
            <table class="w-full text-sm min-w-[780px] table-fixed">
              <colgroup>
                <col :class="segment === 'paper' ? 'w-[22%]' : 'w-[30%]'" />
                <col v-if="segment === 'paper'" class="w-[8%]" />
                <col v-if="segment === 'paper'" class="w-[8%]" />
                <col class="w-[10%]" />
                <col class="w-[10%]" />
                <col class="w-[12%]" />
                <col class="w-[14%]" />
                <col class="w-[10%] hide-on-print" />
              </colgroup>
              <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th class="text-left px-3 py-2">{{ lineLabel(segment) }}</th>
                  <th v-if="segment === 'paper'" class="text-left px-3 py-2">BF</th>
                  <th v-if="segment === 'paper'" class="text-left px-3 py-2">GSM</th>
                  <th class="text-right px-3 py-2">Qty</th>
                  <th class="text-center px-3 py-2">Unit</th>
                  <th class="text-right px-3 py-2">Rate</th>
                  <th class="text-right px-3 py-2 whitespace-nowrap">Amount</th>
                  <th class="text-right px-3 py-2 hide-on-print">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="rowsBySegment[segment].length === 0">
                  <td :colspan="segment === 'paper' ? 8 : 6" class="px-3 py-6 text-center text-slate-400">No rows in this segment.</td>
                </tr>
                <tr v-for="line in rowsBySegment[segment]" :key="line.id" class="border-t border-slate-100">
                  <td class="px-2 py-2 min-w-0">
                    <input v-if="line.segment === 'paper'" v-model="line.paper_name" class="pp-input min-w-0" placeholder="e.g. Kraft Paper" />
                    <input v-else v-model="line.item_name" class="pp-input min-w-0" placeholder="Item name" />
                  </td>
                  <td v-if="line.segment === 'paper'" class="px-2 py-2 min-w-0">
                    <input v-model="line.bf" class="pp-input min-w-0" placeholder="18" />
                  </td>
                  <td v-if="line.segment === 'paper'" class="px-2 py-2 min-w-0">
                    <input v-model="line.gsm" class="pp-input min-w-0" placeholder="120" />
                  </td>
                  <td class="px-2 py-2 min-w-0">
                    <input v-model.number="line.qty" type="number" min="0" step="0.01" class="pp-input min-w-0 text-right" @input="recalcLine(line)" />
                  </td>
                  <td class="px-2 py-2 min-w-0">
                    <input v-model="line.unit" class="pp-input min-w-0 text-center" />
                  </td>
                  <td class="px-2 py-2 min-w-0">
                    <input v-model.number="line.rate" type="number" min="0" step="0.01" class="pp-input min-w-0 text-right" @input="recalcLine(line)" />
                  </td>
                  <td class="px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap">Rs. {{ n2(line.amount) }}</td>
                  <td class="px-3 py-2 text-right hide-on-print">
                    <button type="button" class="text-rose-600 hover:underline" @click="removeRow(line.id)">Remove</button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <td :colspan="segment === 'paper' ? 6 : 4" class="px-3 py-2 text-right">{{ STOCK_SEGMENT_LABELS[segment] }} Total</td>
                  <td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">Rs. {{ n2(segmentTotal(form.lines, segment)) }}</td>
                  <td class="hide-on-print"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="pp-card p-4 overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-lg font-bold text-navy">
            <span class="shrink-0">Grand Total</span>
            <span class="tabular-nums whitespace-nowrap ml-auto">Rs. {{ n2(grandTotal(form.lines)) }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
