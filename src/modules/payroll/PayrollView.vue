<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue'
import PpModal from '@/components/PpModal.vue'
import { usePayrollStore, type NewStaff } from '@/stores/payroll'
import { useFirmStore } from '@/stores/firm'
import type { DayAttendance, PayrollPaymentMode, Staff, StaffPayType } from '@/types/models'
import {
  MAX_STAFF,
  PAYROLL_HOURS_PER_DAY,
  PAYROLL_WORKING_DAYS,
  calcOffDutyHours,
  currentPeriod,
  dayCellClass,
  dayCellLabel,
  dayFromPreset,
  daysInMonth,
  deriveWageRates,
  emptyDay,
  normalizeDayHours,
  periodLabel,
} from '@/services/payrollCalc'

const store = usePayrollStore()
const firmStore = useFirmStore()

type Tab = 'staff' | 'attendance' | 'salary' | 'advance' | 'payslip'
const tab = ref<Tab>('staff')
const period = ref(currentPeriod())

const showStaffModal = ref(false)
const editingStaffId = ref<string | null>(null)
const staffForm = reactive({
  name: '',
  phone: '',
  designation: '',
  pay_type: 'monthly' as StaffPayType,
  monthly_amount: 0,
  bank: '',
  acno: '',
  ifsc: '',
  acname: '',
  is_active: true,
})

const showAdvanceModal = ref(false)
const advanceForm = reactive({
  staff_id: '',
  date: new Date().toISOString().slice(0, 10),
  amount: 0,
  mode: 'cash' as PayrollPaymentMode,
  narration: '',
  postVoucher: true,
})

const payslipStaffId = ref('')
const paymentMode = ref<PayrollPaymentMode>('transfer')
const paymentDate = ref(new Date().toISOString().slice(0, 10))

const showDayModal = ref(false)
const dayModalStaffId = ref('')
const dayModalDay = ref('')
const dayModalStaffName = ref('')
const dayForm = reactive<DayAttendance>(emptyDay())

const dayModalOffHours = computed(() => {
  if (dayForm.duty_hours === null) return 0
  return calcOffDutyHours(dayForm.duty_hours)
})

const wagePreview = computed(() => deriveWageRates(staffForm.monthly_amount))

const selYear = computed(() => Number(period.value.split('-')[0]) || new Date().getFullYear())
const selMonth = computed(() => Number(period.value.split('-')[1]) || 1)
const dim = computed(() => daysInMonth(selYear.value, selMonth.value))
const dayCols = computed(() => Array.from({ length: dim.value }, (_, i) => String(i + 1).padStart(2, '0')))

const currentRun = computed(() => store.runs.find((r) => r.period === period.value))

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'staff', label: 'Staff', icon: '👤' },
  { id: 'attendance', label: 'Attendance', icon: '📅' },
  { id: 'salary', label: 'Salary', icon: '💵' },
  { id: 'advance', label: 'Advance', icon: '💸' },
  { id: 'payslip', label: 'Payslip', icon: '📄' },
]

function blankStaff() {
  Object.assign(staffForm, {
    name: '', phone: '', designation: '', pay_type: 'monthly' as StaffPayType,
    monthly_amount: 0, bank: '', acno: '', ifsc: '', acname: '', is_active: true,
  })
}

function openAddStaff() {
  if (store.staffList.length >= MAX_STAFF) {
    alert(`Maximum ${MAX_STAFF} staff allowed.`)
    return
  }
  editingStaffId.value = null
  blankStaff()
  showStaffModal.value = true
}

function openEditStaff(s: Staff) {
  editingStaffId.value = s.id
  Object.assign(staffForm, {
    name: s.name, phone: s.phone, designation: s.designation, pay_type: s.pay_type,
    monthly_amount: s.monthly_amount, bank: s.bank, acno: s.acno, ifsc: s.ifsc,
    acname: s.acname, is_active: s.is_active,
  })
  showStaffModal.value = true
}

async function saveStaff() {
  if (!staffForm.name.trim()) return alert('Name required')
  const payload: NewStaff = {
    name: staffForm.name.trim(),
    phone: staffForm.phone.trim(),
    designation: staffForm.designation.trim(),
    pay_type: staffForm.pay_type,
    monthly_amount: Math.max(0, Number(staffForm.monthly_amount) || 0),
    bank: staffForm.bank.trim(),
    acno: staffForm.acno.trim(),
    ifsc: staffForm.ifsc.trim().toUpperCase(),
    acname: staffForm.acname.trim() || staffForm.name.trim(),
    is_active: staffForm.is_active,
  }
  if (editingStaffId.value) {
    await store.updateStaff(editingStaffId.value, payload)
  } else {
    const res = await store.addStaff(payload)
    if ('error' in res) return alert(res.error)
  }
  showStaffModal.value = false
}

async function ensurePeriodRun() {
  await store.ensureRun(period.value)
}

watch(period, () => void ensurePeriodRun())
watch(tab, (t) => {
  if (t === 'attendance' || t === 'salary') void ensurePeriodRun()
})

function lineFor(staffId: string) {
  return currentRun.value?.lines.find((l) => l.staff_id === staffId)
}

function dayFor(staffId: string, day: string): DayAttendance | undefined {
  const line = lineFor(staffId)
  if (!line) return undefined
  const hours = normalizeDayHours(line)
  return hours[day]
}

function openDayModal(staffId: string, day: string) {
  if (currentRun.value?.status === 'paid') return alert('Month already paid — attendance locked.')
  const staff = store.activeStaff.find((s) => s.id === staffId)
  const existing = dayFor(staffId, day)
  dayModalStaffId.value = staffId
  dayModalDay.value = day
  dayModalStaffName.value = staff?.name || ''
  Object.assign(dayForm, existing ? { ...existing } : emptyDay())
  showDayModal.value = true
}

function applyDayPreset(preset: 'full' | 'half' | 'absent' | 'leave') {
  Object.assign(dayForm, dayFromPreset(preset))
}

async function saveDayModal() {
  const line = lineFor(dayModalStaffId.value)
  const hours = line ? { ...normalizeDayHours(line) } : {}
  hours[dayModalDay.value] = {
    duty_hours: dayForm.duty_hours === null ? null : Math.max(0, Number(dayForm.duty_hours) || 0),
    off_paid: dayForm.off_paid,
    ot_hours: Math.max(0, Number(dayForm.ot_hours) || 0),
  }
  await store.updateRunLine(period.value, dayModalStaffId.value, { day_hours: hours })
  showDayModal.value = false
}

async function clearDayModal() {
  const line = lineFor(dayModalStaffId.value)
  const hours = line ? { ...normalizeDayHours(line) } : {}
  delete hours[dayModalDay.value]
  await store.updateRunLine(period.value, dayModalStaffId.value, { day_hours: hours })
  showDayModal.value = false
}

async function setOtherDeduction(staffId: string, amount: number) {
  if (currentRun.value?.status === 'paid') return
  await store.updateRunLine(period.value, staffId, { other_deduction: Math.max(0, amount) })
}

async function recalculate() {
  const res = await store.recalculateRun(period.value)
  if (res && 'error' in res) alert(res.error)
}

async function paySalary() {
  if (!currentRun.value) return alert('Open attendance / salary for this month first.')
  if (currentRun.value.status === 'paid') return alert('Already paid.')
  if (!confirm(`Pay salary ${periodLabel(period.value)} — net ₹${currentRun.value.total_net.toLocaleString('en-IN')}?`)) return
  const res = await store.payRun(period.value, paymentMode.value, paymentDate.value)
  if ('error' in res) alert(res.error)
  else alert('Salary voucher posted to Accounting (5101).')
}

function openAdvance() {
  advanceForm.staff_id = store.activeStaff[0]?.id || ''
  advanceForm.date = new Date().toISOString().slice(0, 10)
  advanceForm.amount = 0
  advanceForm.narration = ''
  advanceForm.postVoucher = true
  showAdvanceModal.value = true
}

async function saveAdvance() {
  const res = await store.recordAdvance({ ...advanceForm, amount: Number(advanceForm.amount) })
  if ('error' in res) return alert(res.error)
  showAdvanceModal.value = false
}

function printPayslip() {
  window.print()
}

const payslipLine = computed(() => {
  if (!payslipStaffId.value || !currentRun.value) return null
  return currentRun.value.lines.find((l) => l.staff_id === payslipStaffId.value) || null
})

onMounted(async () => {
  await firmStore.load()
  await store.load()
  if (store.activeStaff.length) payslipStaffId.value = store.activeStaff[0].id
})
</script>

<template>
  <div class="p-4 sm:p-6 max-w-6xl mx-auto pb-24">
    <header class="mb-4">
      <h1 class="text-xl sm:text-2xl font-bold text-navy">Payroll</h1>
      <p class="text-xs sm:text-sm text-slate-500">
        Staff, attendance, salary &amp; advances — max {{ MAX_STAFF }} staff · monthly ÷ {{ PAYROLL_WORKING_DAYS }} daily wage
      </p>
    </header>

    <div class="flex flex-wrap items-center gap-2 mb-4">
      <label class="text-sm font-semibold text-slate-600">Month</label>
      <input v-model="period" type="month" class="pp-input !w-auto" />
      <span v-if="currentRun" class="text-xs pp-badge" :class="{
        'bg-slate-100 text-slate-600': currentRun.status === 'draft',
        'bg-amber-100 text-amber-800': currentRun.status === 'finalized',
        'bg-emerald-100 text-emerald-800': currentRun.status === 'paid',
      }">{{ currentRun.status }}</span>
    </div>

    <nav class="flex gap-1 overflow-x-auto pb-2 mb-4 -mx-1 px-1 scrollbar-thin">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
        :class="tab === t.id ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600'"
        @click="tab = t.id"
      >
        {{ t.icon }} {{ t.label }}
      </button>
    </nav>

    <!-- STAFF -->
    <section v-if="tab === 'staff'" class="space-y-3">
      <div class="flex justify-between items-center">
        <span class="text-sm text-slate-500">{{ store.staffList.length }} / {{ MAX_STAFF }} staff</span>
        <button class="pp-btn pp-btn-primary !py-2" @click="openAddStaff">+ Add Staff</button>
      </div>
      <div v-if="store.staffList.length === 0" class="pp-card p-8 text-center text-slate-400">
        <div class="text-4xl mb-2">👤</div>
        Add your first staff member.
      </div>
      <div v-for="s in store.staffList" :key="s.id" class="pp-card p-4 flex flex-wrap gap-3 justify-between items-start">
        <div class="min-w-0 flex-1">
          <div class="font-bold text-navy flex items-center gap-2 flex-wrap">
            {{ s.name }}
            <span v-if="!s.is_active" class="pp-badge bg-slate-200 text-slate-600">Inactive</span>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            {{ s.designation || '—' }} ·
            <span class="font-semibold">{{ s.pay_type === 'monthly' ? 'Monthly' : 'Daily wage' }}</span>
            · ₹{{ s.monthly_amount.toLocaleString('en-IN') }}/mo
          </div>
          <div v-if="s.pay_type === 'daily_wage'" class="text-xs text-emerald-700 mt-1">
            Daily ₹{{ s.daily_wage }} · Hourly ₹{{ s.hourly_wage }}
          </div>
          <div v-if="s.phone" class="text-xs text-slate-400 mt-0.5">{{ s.phone }}</div>
        </div>
        <div class="flex gap-2">
          <button class="pp-btn pp-btn-ghost !py-1.5" @click="openEditStaff(s)">Edit</button>
          <button class="pp-btn pp-btn-danger !py-1.5" @click="store.removeStaff(s.id)">Remove</button>
        </div>
      </div>
    </section>

    <!-- ATTENDANCE -->
    <section v-else-if="tab === 'attendance'" class="space-y-3">
      <p class="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
        <strong>Tap day</strong> → duty hours (0–8), off-duty auto (e.g. 6 hr duty = 2 hr off), choose <strong>paid/unpaid</strong> off, + <strong>OT</strong>.
        Cell: <span class="font-mono">6✓</span> = 6 hr + paid off · <span class="font-mono">6−</span> = unpaid off · <span class="font-mono">8+2</span> = OT
      </p>
      <div v-if="store.activeStaff.length === 0" class="pp-card p-6 text-center text-slate-400">Add staff first.</div>
      <div v-else class="overflow-x-auto -mx-4 px-4">
        <table class="text-xs border-collapse min-w-max">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-white border border-slate-200 px-2 py-2 text-left min-w-[100px]">Staff</th>
              <th v-for="d in dayCols" :key="d" class="border border-slate-200 px-0.5 py-1 w-8 text-center text-slate-500">{{ Number(d) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in store.activeStaff" :key="s.id">
              <td class="sticky left-0 z-10 bg-white border border-slate-200 px-2 py-2 font-semibold text-navy truncate max-w-[120px]">{{ s.name }}</td>
              <td v-for="d in dayCols" :key="d" class="border border-slate-200 p-0.5">
                <button
                  type="button"
                  class="min-w-8 h-8 px-0.5 rounded text-[9px] font-bold flex items-center justify-center"
                  :class="dayCellClass(dayFor(s.id, d))"
                  :disabled="currentRun?.status === 'paid'"
                  @click="openDayModal(s.id, d)"
                >
                  {{ dayCellLabel(dayFor(s.id, d)) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- SALARY -->
    <section v-else-if="tab === 'salary'" class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <button class="pp-btn pp-btn-ghost" :disabled="currentRun?.status === 'paid'" @click="recalculate">Recalculate</button>
      </div>
      <div v-if="!currentRun" class="pp-card p-6 text-center text-slate-400">Select month &amp; mark attendance.</div>
      <template v-else>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div class="pp-card p-3 text-center">
            <div class="text-xs text-slate-500">Gross</div>
            <div class="font-bold text-navy">₹{{ currentRun.total_earned.toLocaleString('en-IN') }}</div>
          </div>
          <div class="pp-card p-3 text-center">
            <div class="text-xs text-slate-500">Advance</div>
            <div class="font-bold text-amber-700">₹{{ currentRun.total_advance.toLocaleString('en-IN') }}</div>
          </div>
          <div class="pp-card p-3 text-center">
            <div class="text-xs text-slate-500">Other ded.</div>
            <div class="font-bold">₹{{ currentRun.total_other.toLocaleString('en-IN') }}</div>
          </div>
          <div class="pp-card p-3 text-center bg-emerald-50 border-emerald-200">
            <div class="text-xs text-emerald-700">Net pay</div>
            <div class="font-bold text-emerald-800">₹{{ currentRun.total_net.toLocaleString('en-IN') }}</div>
          </div>
        </div>

        <div class="pp-card overflow-x-auto">
          <table class="w-full text-sm min-w-[520px]">
            <thead class="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th class="text-left px-3 py-2">Staff</th>
                <th class="text-right px-2 py-2">Duty h</th>
                <th class="text-right px-2 py-2">Off unpaid</th>
                <th class="text-right px-2 py-2">OT h</th>
                <th class="text-right px-2 py-2">Paid h</th>
                <th class="text-right px-2 py-2">Earned</th>
                <th class="text-right px-2 py-2">Adv</th>
                <th class="text-right px-2 py-2">Other</th>
                <th class="text-right px-3 py-2">Net</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in currentRun.lines" :key="line.staff_id" class="border-t border-slate-100">
                <td class="px-3 py-2 font-semibold">{{ line.staff_name }}</td>
                <td class="px-2 py-2 text-right text-xs">{{ line.total_duty_hours ?? 0 }}</td>
                <td class="px-2 py-2 text-right text-xs text-rose-600">{{ line.total_off_unpaid_hours ?? 0 }}</td>
                <td class="px-2 py-2 text-right text-xs">{{ line.total_ot_hours ?? 0 }}</td>
                <td class="px-2 py-2 text-right text-xs font-semibold">{{ line.total_paid_hours ?? 0 }}</td>
                <td class="px-2 py-2 text-right">₹{{ line.earned.toLocaleString('en-IN') }}</td>
                <td class="px-2 py-2 text-right text-amber-700">₹{{ line.advance_deduction.toLocaleString('en-IN') }}</td>
                <td class="px-2 py-2 text-right">
                  <input
                    type="number"
                    min="0"
                    class="pp-input !w-16 !py-1 !text-right text-xs"
                    :value="line.other_deduction"
                    :disabled="currentRun.status === 'paid'"
                    @change="setOtherDeduction(line.staff_id, Number(($event.target as HTMLInputElement).value))"
                  />
                </td>
                <td class="px-3 py-2 text-right font-bold">₹{{ line.net_pay.toLocaleString('en-IN') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="currentRun.status !== 'paid'" class="pp-card p-4 space-y-3">
          <h3 class="font-bold text-navy">Pay salary (combined voucher → 5101)</h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="pp-label">Payment mode</label>
              <select v-model="paymentMode" class="pp-input">
                <option value="transfer">Bank transfer</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div>
              <label class="pp-label">Payment date</label>
              <input v-model="paymentDate" type="date" class="pp-input" />
            </div>
            <div class="flex items-end">
              <button class="pp-btn pp-btn-primary w-full" @click="paySalary">Post payment voucher</button>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-emerald-700">Paid — voucher in Accounting.</p>
      </template>
    </section>

    <!-- ADVANCE -->
    <section v-else-if="tab === 'advance'" class="space-y-3">
      <button class="pp-btn pp-btn-primary" @click="openAdvance">+ Record advance</button>
      <div v-if="store.advances.length === 0" class="pp-card p-6 text-center text-slate-400">No advances yet.</div>
      <div v-for="a in store.advances" :key="a.id" class="pp-card p-3 flex justify-between gap-2 flex-wrap text-sm">
        <div>
          <span class="font-semibold text-navy">{{ a.staff_name }}</span>
          <span class="text-slate-500 ml-2">{{ a.date }}</span>
          <div class="text-xs text-slate-400">{{ a.mode }} · {{ a.narration || '—' }}</div>
        </div>
        <div class="text-right">
          <div class="font-bold">₹{{ a.amount.toLocaleString('en-IN') }}</div>
          <span v-if="a.applied_period" class="text-xs text-emerald-600">Adjusted {{ a.applied_period }}</span>
          <span v-else class="text-xs text-amber-600">Open</span>
        </div>
      </div>
    </section>

    <!-- PAYSLIP -->
    <section v-else-if="tab === 'payslip'" class="space-y-4">
      <div class="flex flex-wrap gap-2 items-center print:hidden">
        <select v-model="payslipStaffId" class="pp-input max-w-xs">
          <option v-for="s in store.activeStaff" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button class="pp-btn pp-btn-ghost" @click="printPayslip">Print payslip</button>
      </div>
      <div v-if="!payslipLine" class="pp-card p-6 text-center text-slate-400">No salary data for this month.</div>
      <div v-else id="payslip-print" class="pp-card p-6 max-w-md mx-auto border-2 border-slate-200">
        <div class="text-center border-b border-slate-200 pb-3 mb-3">
          <div class="font-bold text-lg text-navy">{{ firmStore.activeFirm?.name || 'Firm' }}</div>
          <div class="text-sm text-slate-500">Payslip — {{ periodLabel(period) }}</div>
        </div>
        <div class="space-y-1 text-sm mb-4">
          <div><span class="text-slate-500">Employee:</span> <strong>{{ payslipLine.staff_name }}</strong></div>
          <div><span class="text-slate-500">Type:</span> {{ payslipLine.pay_type === 'monthly' ? 'Monthly' : 'Daily wage' }}</div>
          <div><span class="text-slate-500">Duty hours:</span> {{ payslipLine.total_duty_hours ?? 0 }}</div>
          <div><span class="text-slate-500">Off unpaid:</span> {{ payslipLine.total_off_unpaid_hours ?? 0 }} hr</div>
          <div><span class="text-slate-500">OT hours:</span> {{ payslipLine.total_ot_hours ?? 0 }}</div>
          <div><span class="text-slate-500">Paid hours:</span> {{ payslipLine.total_paid_hours ?? 0 }}</div>
          <div class="text-xs text-slate-400">Days: {{ payslipLine.days_present }} present · {{ payslipLine.days_half }} partial · {{ payslipLine.days_absent }} absent · {{ payslipLine.days_leave }} leave</div>
        </div>
        <table class="w-full text-sm border-t border-slate-200">
          <tbody>
            <tr><td class="py-2">Gross earned</td><td class="py-2 text-right font-semibold">₹{{ payslipLine.earned.toLocaleString('en-IN') }}</td></tr>
            <tr v-if="payslipLine.advance_deduction"><td class="py-2 text-amber-700">Advance deduction</td><td class="py-2 text-right">− ₹{{ payslipLine.advance_deduction.toLocaleString('en-IN') }}</td></tr>
            <tr v-if="payslipLine.other_deduction"><td class="py-2">Other deduction</td><td class="py-2 text-right">− ₹{{ payslipLine.other_deduction.toLocaleString('en-IN') }}</td></tr>
            <tr class="border-t-2 border-navy font-bold text-base"><td class="py-3">Net pay</td><td class="py-3 text-right text-emerald-800">₹{{ payslipLine.net_pay.toLocaleString('en-IN') }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Staff modal -->
    <PpModal v-if="showStaffModal" :title="editingStaffId ? 'Edit Staff' : 'Add Staff'" @close="showStaffModal = false">
      <div class="space-y-3">
        <div>
          <label class="pp-label">Name *</label>
          <input v-model="staffForm.name" class="pp-input" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Phone</label>
            <input v-model="staffForm.phone" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Designation</label>
            <input v-model="staffForm.designation" class="pp-input" />
          </div>
        </div>
        <div>
          <label class="pp-label">Pay type</label>
          <select v-model="staffForm.pay_type" class="pp-input">
            <option value="monthly">Monthly salary</option>
            <option value="daily_wage">Daily wage (monthly ÷ 26)</option>
          </select>
        </div>
        <div>
          <label class="pp-label">{{ staffForm.pay_type === 'daily_wage' ? 'Monthly equivalent (÷26)' : 'Monthly salary' }} ₹</label>
          <input v-model.number="staffForm.monthly_amount" type="number" min="0" class="pp-input" />
          <p v-if="staffForm.pay_type === 'daily_wage' && staffForm.monthly_amount > 0" class="text-xs text-emerald-700 mt-1">
            Daily ₹{{ wagePreview.daily_wage }} · Hourly ₹{{ wagePreview.hourly_wage }} (rounded up)
          </p>
        </div>
        <details class="text-sm">
          <summary class="cursor-pointer text-slate-500 font-semibold">Bank (for transfer)</summary>
          <div class="grid grid-cols-1 gap-2 mt-2">
            <input v-model="staffForm.acno" class="pp-input" placeholder="Account no" />
            <input v-model="staffForm.ifsc" class="pp-input uppercase" placeholder="IFSC" />
            <input v-model="staffForm.bank" class="pp-input" placeholder="Bank" />
            <input v-model="staffForm.acname" class="pp-input" placeholder="Account name" />
          </div>
        </details>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="staffForm.is_active" type="checkbox" /> Active
        </label>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showStaffModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="saveStaff">Save</button>
        </div>
      </div>
    </PpModal>

    <!-- Day attendance modal -->
    <PpModal
      v-if="showDayModal"
      :title="`${dayModalStaffName} — ${Number(dayModalDay)} ${periodLabel(period)}`"
      @close="showDayModal = false"
    >
      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <button type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs" @click="applyDayPreset('full')">Full 8h</button>
          <button type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs" @click="applyDayPreset('half')">Half 4h</button>
          <button type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs" @click="applyDayPreset('absent')">Absent</button>
          <button type="button" class="pp-btn pp-btn-ghost !py-1.5 text-xs" @click="applyDayPreset('leave')">Leave (paid)</button>
        </div>

        <div>
          <label class="pp-label">Duty hours (0–{{ PAYROLL_HOURS_PER_DAY }}+)</label>
          <input
            v-model.number="dayForm.duty_hours"
            type="number"
            min="0"
            max="16"
            step="0.5"
            class="pp-input text-lg font-bold"
            placeholder="e.g. 6"
          />
          <p class="text-xs text-slate-500 mt-1">8 ghante standard din — jitni duty, utna yahan.</p>
        </div>

        <div
          v-if="dayForm.duty_hours !== null && dayModalOffHours > 0"
          class="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
        >
          <div class="text-sm">
            <span class="text-slate-500">Off duty (auto):</span>
            <strong class="text-navy ml-1">{{ dayModalOffHours }} hr</strong>
            <span class="text-slate-400 text-xs ml-1">({{ PAYROLL_HOURS_PER_DAY }} − {{ dayForm.duty_hours }})</span>
          </div>
          <label class="flex items-center gap-3 cursor-pointer">
            <input v-model="dayForm.off_paid" type="checkbox" class="w-5 h-5" />
            <span class="text-sm">
              <strong>Off-duty hours paid</strong>
              <span class="block text-xs text-slate-500">Unchecked = unpaid (salary se cut)</span>
            </span>
          </label>
        </div>

        <div>
          <label class="pp-label">Overtime (OT) hours</label>
          <input
            v-model.number="dayForm.ot_hours"
            type="number"
            min="0"
            step="0.5"
            class="pp-input"
            placeholder="Extra beyond 8 hr day"
          />
          <p class="text-xs text-emerald-700 mt-1">OT hamesha paid — hourly rate se.</p>
        </div>

        <div class="flex justify-between gap-2 pt-2">
          <button type="button" class="pp-btn pp-btn-danger !py-1.5" @click="clearDayModal">Clear day</button>
          <div class="flex gap-2">
            <button type="button" class="pp-btn pp-btn-ghost" @click="showDayModal = false">Cancel</button>
            <button type="button" class="pp-btn pp-btn-primary" @click="saveDayModal">Save</button>
          </div>
        </div>
      </div>
    </PpModal>

    <!-- Advance modal -->
    <PpModal v-if="showAdvanceModal" title="Record advance" @close="showAdvanceModal = false">
      <div class="space-y-3">
        <div>
          <label class="pp-label">Staff *</label>
          <select v-model="advanceForm.staff_id" class="pp-input">
            <option v-for="s in store.activeStaff" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pp-label">Date</label>
            <input v-model="advanceForm.date" type="date" class="pp-input" />
          </div>
          <div>
            <label class="pp-label">Amount ₹</label>
            <input v-model.number="advanceForm.amount" type="number" min="1" class="pp-input" />
          </div>
        </div>
        <div>
          <label class="pp-label">Mode</label>
          <select v-model="advanceForm.mode" class="pp-input">
            <option value="cash">Cash</option>
            <option value="transfer">Bank transfer</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Note</label>
          <input v-model="advanceForm.narration" class="pp-input" placeholder="Optional" />
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="advanceForm.postVoucher" type="checkbox" />
          Post accounting voucher (Dr Staff Advances, Cr {{ advanceForm.mode === 'cash' ? 'Cash' : 'Bank' }})
        </label>
        <div class="flex justify-end gap-2">
          <button class="pp-btn pp-btn-ghost" @click="showAdvanceModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="saveAdvance">Save</button>
        </div>
      </div>
    </PpModal>
  </div>
</template>

<style scoped>
@media print {
  body * { visibility: hidden; }
  #payslip-print, #payslip-print * { visibility: visible; }
  #payslip-print { position: absolute; left: 0; top: 0; width: 100%; }
}
</style>
