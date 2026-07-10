<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue'
import PpModal from '@/components/PpModal.vue'
import { usePayrollStore, type NewStaff } from '@/stores/payroll'
import { useFirmStore } from '@/stores/firm'
import type { DayAttendance, PayrollPaymentMode, Staff, StaffAdvance, StaffPayType } from '@/types/models'
import {
  MAX_STAFF,
  PAYROLL_HOURS_PER_DAY,
  PAYROLL_WORKING_DAYS,
  advancePayrollPeriod,
  advanceAdjustedInLabel,
  calcOffDutyHours,
  currentPeriod,
  dayCellClass,
  dayCellLabel,
  dayFromPreset,
  daysInMonth,
  defaultSalaryDateForPeriod,
  deriveWageRates,
  emptyDay,
  isSunday,
  lineBalanceDue,
  normalizeDayHours,
  periodLabel,
  resolveRunSalaryDate,
  salaryCycleStartDate,
  sumDaySalaryExpense,
  sundayDayKeys,
} from '@/services/payrollCalc'
import { buildStaffLedger } from '@/services/staffLedger'
import { downloadPayrollPayslipsPdf, payrollPayTypeLabel } from '@/services/payrollPdf'
import { pickBestPayrollRun } from '@/services/payrollRuns'
import {
  generateStaffHoursMessage,
  hasMarkedAttendance,
  openStaffHoursWhatsApp,
} from '@/services/payrollWhatsApp'

const store = usePayrollStore()
const firmStore = useFirmStore()

type Tab = 'staff' | 'attendance' | 'salary' | 'advance' | 'ledger' | 'payslip'
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
  leaving_date: '',
})

const showAdvanceModal = ref(false)
const editingAdvanceId = ref<string | null>(null)
const advanceForm = reactive({
  staff_id: '',
  date: new Date().toISOString().slice(0, 10),
  amount: 0,
  mode: 'cash' as PayrollPaymentMode,
  narration: '',
  postVoucher: true,
  payroll_period: currentPeriod(),
})

const showStaffPayModal = ref(false)
const staffPayStaffId = ref('')
const staffPayAmount = ref(0)

const ledgerStaffId = ref('')

const payslipStaffId = ref('')
const salaryDate = ref(defaultSalaryDateForPeriod(currentPeriod()))
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

const currentRun = computed(() => {
  const matches = store.runs.filter((r) => r.period === period.value && !r.is_deleted)
  return matches.length ? pickBestPayrollRun(matches) : undefined
})

/** Staff eligible for the selected payroll month (excludes people who left earlier). */
const periodStaff = computed(() => store.staffForPeriod(period.value))
const selectedBulkDays = ref<Set<string>>(new Set())
const attendanceEditMode = ref(false)
const showDayActionModal = ref(false)
const dayActionStaffId = ref('')
const dayActionDay = ref('')
const dayActionStaffName = ref('')

const sundaysThisMonth = computed(() => sundayDayKeys(selYear.value, selMonth.value))
const selectedBulkCount = computed(() => selectedBulkDays.value.size)

const daySalaryExpense = computed(() => {
  const map: Record<string, number> = {}
  for (const d of dayCols.value) {
    map[d] = sumDaySalaryExpense(d, periodStaff.value, currentRun.value?.lines)
  }
  return map
})

function fmtLeavingDate(date: string | undefined): string {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const attendanceSalaryExpenseTotal = computed(() =>
  Object.values(daySalaryExpense.value).reduce((sum, n) => sum + n, 0),
)

function fmtDaySalaryExpense(amount: number): string {
  if (amount <= 0) return '·'
  return `₹${amount.toLocaleString('en-IN')}`
}

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'staff', label: 'Staff', icon: '👤' },
  { id: 'attendance', label: 'Attendance', icon: '📅' },
  { id: 'salary', label: 'Salary', icon: '💵' },
  { id: 'advance', label: 'Advance', icon: '💸' },
  { id: 'ledger', label: 'Ledger', icon: '📒' },
  { id: 'payslip', label: 'Payslip', icon: '📄' },
]

function blankStaff() {
  Object.assign(staffForm, {
    name: '', phone: '', designation: '', pay_type: 'monthly' as StaffPayType,
    monthly_amount: 0, bank: '', acno: '', ifsc: '', acname: '', is_active: true, leaving_date: '',
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
    acname: s.acname, is_active: s.is_active, leaving_date: s.leaving_date || '',
  })
  showStaffModal.value = true
}

async function saveStaff() {
  if (!staffForm.name.trim()) return alert('Name required')
  const leaving_date = staffForm.leaving_date || ''
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
    leaving_date,
    is_active: leaving_date ? false : staffForm.is_active,
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

watch(period, () => {
  selectedBulkDays.value = new Set()
  attendanceEditMode.value = false
  salaryDate.value = defaultSalaryDateForPeriod(period.value)
  void ensurePeriodRun()
})

watch(salaryDate, async (next, prev) => {
  if (!next || next === prev) return
  paymentDate.value = next
  await ensurePeriodRun()
  const run = currentRun.value
  if (!run || run.period !== period.value) return
  if (run.status === 'paid') return
  if (run.salary_date === next) return
  const res = await store.updateRunSalaryDate(period.value, next)
  if (res && 'error' in res) alert(res.error)
})

watch(currentRun, (run) => {
  if (!run) return
  const resolved = resolveRunSalaryDate(run)
  if (salaryDate.value !== resolved) salaryDate.value = resolved
  paymentDate.value = resolved
}, { immediate: true })
watch(tab, (t) => {
  if (t !== 'attendance') attendanceEditMode.value = false
  if (t === 'attendance' || t === 'salary') void ensurePeriodRun()
})

const canEditAttendance = computed(
  () => attendanceEditMode.value && currentRun.value?.status !== 'paid',
)

function startAttendanceEdit() {
  if (currentRun.value?.status === 'paid') return alert('Month paid — attendance locked.')
  attendanceEditMode.value = true
}

function stopAttendanceEdit() {
  attendanceEditMode.value = false
  selectedBulkDays.value = new Set()
  showDayActionModal.value = false
}

function toggleBulkDay(day: string) {
  if (!canEditAttendance.value) return
  const next = new Set(selectedBulkDays.value)
  if (next.has(day)) next.delete(day)
  else next.add(day)
  selectedBulkDays.value = next
}

function isBulkDaySelected(day: string) {
  return selectedBulkDays.value.has(day)
}

async function bulkPresentOneDay(day: string) {
  if (!canEditAttendance.value) return
  if (currentRun.value?.status === 'paid') return alert('Month already paid.')
  if (!confirm(`Din ${Number(day)} — sab staff PRESENT (8 hr) mark karein?`)) return
  const res = await store.bulkMarkDays(period.value, [day], 'full')
  if (res && 'error' in res) alert(res.error)
}

async function bulkMarkSelected(preset: 'full' | 'holiday' | 'sunday') {
  if (!canEditAttendance.value) return
  if (currentRun.value?.status === 'paid') return alert('Month already paid.')
  const days = [...selectedBulkDays.value]
  if (!days.length) return alert('Pehle upar se din select karein (tap on date).')
  const label = preset === 'full' ? 'SAB PRESENT (8 hr)' : preset === 'holiday' ? 'FACTORY HOLIDAY (paid)' : 'WEEKLY OFF / Sunday (unpaid, ÷26)'
  if (!confirm(`${days.length} din — sab staff ke liye ${label}?`)) return
  const res = await store.bulkMarkDays(period.value, days, preset)
  if (res && 'error' in res) alert(res.error)
}

async function bulkAllSundays() {
  if (!canEditAttendance.value) return
  if (currentRun.value?.status === 'paid') return alert('Month already paid.')
  const days = sundaysThisMonth.value
  if (!days.length) return alert('Is month me Sunday nahi hai.')
  if (!confirm(`Sab ${days.length} Sundays — sab staff weekly off (unpaid, ÷26 me pehle se) mark karein?`)) return
  const res = await store.bulkMarkDays(period.value, days, 'sunday')
  if (res && 'error' in res) alert(res.error)
}

function openDayActionMenu(staffId: string, day: string) {
  if (!canEditAttendance.value) return
  const staff = periodStaff.value.find((s) => s.id === staffId)
  dayActionStaffId.value = staffId
  dayActionDay.value = day
  dayActionStaffName.value = staff?.name || ''
  showDayActionModal.value = true
}

async function applyStaffDayPreset(preset: 'full' | 'absent' | 'holiday' | 'sunday' | 'clear') {
  const staffId = dayActionStaffId.value
  const day = dayActionDay.value
  const line = lineFor(staffId)
  const hours = line ? { ...normalizeDayHours(line) } : {}

  if (preset === 'clear') {
    if (!confirm(`${dayActionStaffName.value} — din ${Number(day)} clear karein?`)) return
    delete hours[day]
  } else {
    const labels: Record<string, string> = {
      full: 'PRESENT (8 hr)',
      absent: 'ABSENT',
      holiday: 'HOLIDAY (paid)',
      sunday: 'WEEKLY OFF (unpaid, ÷26)',
    }
    if (!confirm(`${dayActionStaffName.value} — ${Number(day)} → ${labels[preset]}?`)) return
    hours[day] = { ...dayFromPreset(preset) }
  }

  await store.updateRunLine(period.value, staffId, { day_hours: hours })
  showDayActionModal.value = false
}

function openPartialFromActionMenu() {
  const staffId = dayActionStaffId.value
  const day = dayActionDay.value
  showDayActionModal.value = false
  openDayModal(staffId, day)
}

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
  const staff = periodStaff.value.find((s) => s.id === staffId)
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
  const duty = dayForm.duty_hours === null ? null : Math.max(0, Number(dayForm.duty_hours) || 0)
  hours[dayModalDay.value] = {
    duty_hours: duty,
    off_paid: dayForm.off_paid,
    ot_hours: Math.max(0, Number(dayForm.ot_hours) || 0),
    kind: duty === null ? undefined : duty >= PAYROLL_HOURS_PER_DAY && !dayForm.ot_hours ? 'work' : 'work',
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

function staffHoursMessage(staffId: string): string | null {
  const staff = store.staffList.find((s) => s.id === staffId)
  const line = lineFor(staffId)
  if (!staff || !line) return null
  const firmName = firmStore.activeFirm?.name || 'PAMA'
  return generateStaffHoursMessage(firmName, staff, line, selYear.value, selMonth.value)
}

async function shareStaffHoursWhatsApp(staffId: string) {
  await ensurePeriodRun()
  const staff = store.staffList.find((s) => s.id === staffId)
  const line = lineFor(staffId)
  if (!staff || !line) return alert('Pehle attendance mark karein.')
  if (!hasMarkedAttendance(line)) return alert(`${staff.name}: is month me koi din mark nahi.`)
  const msg = staffHoursMessage(staffId)
  if (!msg) return
  if (!staff.phone?.trim()) {
    if (!confirm(`${staff.name}: phone number nahi hai. WhatsApp bina number ke khulega — theek hai?`)) return
  }
  openStaffHoursWhatsApp(staff.phone, msg)
}

async function shareAllStaffHoursWhatsApp() {
  await ensurePeriodRun()
  const eligible = periodStaff.value.filter((s) => hasMarkedAttendance(lineFor(s.id)))
  if (!eligible.length) return alert('Kisi staff ki attendance mark nahi hai.')
  if (!confirm(`${eligible.length} staff — ek-ek karke WhatsApp khulega. Continue?`)) return
  for (const s of eligible) {
    if (!confirm(`WhatsApp bhejein: ${s.name}?`)) continue
    const msg = staffHoursMessage(s.id)
    if (!msg) continue
    openStaffHoursWhatsApp(s.phone, msg)
  }
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
  editingAdvanceId.value = null
  advanceForm.staff_id = periodStaff.value[0]?.id || ''
  advanceForm.date = `${period.value}-01`
  advanceForm.payroll_period = period.value
  advanceForm.amount = 0
  advanceForm.narration = ''
  advanceForm.postVoucher = true
  showAdvanceModal.value = true
}

function openEditAdvance(a: StaffAdvance) {
  if (a.applied_period) return alert('Adjusted advance edit nahi ho sakta.')
  editingAdvanceId.value = a.id
  advanceForm.staff_id = a.staff_id
  advanceForm.date = a.date
  advanceForm.amount = a.amount
  advanceForm.mode = a.mode
  advanceForm.narration = a.narration
  advanceForm.payroll_period = advancePayrollPeriod(a)
  advanceForm.postVoucher = false
  showAdvanceModal.value = true
}

async function saveAdvance() {
  const payload = {
    ...advanceForm,
    amount: Number(advanceForm.amount),
    payroll_period: advanceForm.payroll_period || period.value,
  }
  const res = editingAdvanceId.value
    ? await store.updateAdvance(editingAdvanceId.value, payload, advanceForm.postVoucher)
    : await store.recordAdvance(payload)
  if ('error' in res) return alert(res.error)
  showAdvanceModal.value = false
  await store.recalculateRun(period.value)
}

async function deleteAdvance(id: string) {
  if (!confirm('Ye advance delete karein?')) return
  const res = await store.removeAdvance(id)
  if ('error' in res) return alert(res.error)
  await store.recalculateRun(period.value)
}

const cycleAdvances = computed(() => {
  if (!salaryDate.value) return []
  const start = salaryCycleStartDate(salaryDate.value)
  return store.advances.filter((a) => a.date >= start && a.date <= salaryDate.value)
})

function openStaffPay(lineStaffId: string, balance: number) {
  staffPayStaffId.value = lineStaffId
  staffPayAmount.value = balance
  showStaffPayModal.value = true
}

async function confirmStaffPay() {
  const res = await store.payStaffLine(
    period.value,
    staffPayStaffId.value,
    Number(staffPayAmount.value),
    paymentMode.value,
    paymentDate.value,
  )
  if ('error' in res) return alert(res.error)
  showStaffPayModal.value = false
}

const staffLedger = computed(() => {
  if (!ledgerStaffId.value) return null
  return buildStaffLedger(ledgerStaffId.value, store.advances, store.runs)
})

function printPayslip() {
  window.print()
}

function downloadCurrentPayslipPdf() {
  if (!payslipLine.value) return
  downloadPayrollPayslipsPdf(
    [payslipLine.value],
    period.value,
    firmStore.activeFirm,
    `Payslip_${payslipLine.value.staff_name}_${period.value}.pdf`,
    salaryDate.value,
  )
}

function downloadAllPayslipsPdf() {
  if (!currentRun.value?.lines?.length) return alert('Is month ke liye payslip data nahi hai.')
  downloadPayrollPayslipsPdf(currentRun.value.lines, period.value, firmStore.activeFirm, undefined, salaryDate.value)
}

const payslipLine = computed(() => {
  if (!payslipStaffId.value || !currentRun.value) return null
  return currentRun.value.lines.find((l) => l.staff_id === payslipStaffId.value) || null
})

onMounted(async () => {
  await firmStore.load()
  await store.load()
  if (periodStaff.value.length) {
    payslipStaffId.value = periodStaff.value[0].id
    ledgerStaffId.value = periodStaff.value[0].id
  }
})
</script>

<template>
  <div class="p-4 sm:p-6 max-w-6xl mx-auto pb-24">
    <header class="mb-4">
      <h1 class="text-xl sm:text-2xl font-bold text-navy">Payroll</h1>
      <p class="text-xs sm:text-sm text-slate-500">
        Staff, attendance, salary &amp; advances — max {{ MAX_STAFF }} staff · monthly ÷ {{ PAYROLL_WORKING_DAYS }} daily wage
      </p>
      <p class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mt-2">
        💾 Staff list, attendance, salary runs — <strong>JSON backup</strong> + <strong>Supabase cloud sync</strong> (Settings → Sync Now). Migrations <code>011</code> + <code>012</code> run karein.
      </p>
    </header>

    <div class="flex flex-wrap items-center gap-2 mb-4">
      <label class="text-sm font-semibold text-slate-600">Salary month</label>
      <input v-model="period" type="month" class="pp-input !w-auto" />
      <label class="text-sm font-semibold text-slate-600">Salary day</label>
      <input v-model="salaryDate" type="date" class="pp-input !w-auto" :disabled="currentRun?.status === 'paid'" />
      <span v-if="salaryDate" class="text-xs text-slate-500">
        Advance window: {{ salaryCycleStartDate(salaryDate) }} → {{ salaryDate }}
      </span>
      <span v-if="currentRun" class="text-xs pp-badge" :class="{
        'bg-slate-100 text-slate-600': currentRun.status === 'draft',
        'bg-amber-100 text-amber-800': currentRun.status === 'finalized',
        'bg-sky-100 text-sky-800': currentRun.status === 'partial',
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
            <span v-if="s.leaving_date" class="pp-badge bg-rose-100 text-rose-700">Left {{ fmtLeavingDate(s.leaving_date) }}</span>
            <span v-else-if="!s.is_active" class="pp-badge bg-slate-200 text-slate-600">Inactive</span>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            {{ s.designation || '—' }} ·
            <span class="font-semibold">{{ s.pay_type === 'monthly' ? 'Monthly' : 'Daily wage' }}</span>
            · ₹{{ s.monthly_amount.toLocaleString('en-IN') }}/mo
          </div>
          <div v-if="s.pay_type === 'daily_wage'" class="text-xs text-emerald-700 mt-1">
            Daily ₹{{ s.daily_wage }} · Hourly ₹{{ s.hourly_wage }}
          </div>
          <div v-if="s.leaving_date" class="text-xs text-rose-600 mt-1">
            Leaving month tak payroll me dikhega, uske baad nahi.
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
      <div
        class="rounded-lg border px-3 py-3 flex flex-wrap items-center justify-between gap-2"
        :class="canEditAttendance ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'"
      >
        <div class="text-xs leading-relaxed" :class="canEditAttendance ? 'text-amber-900' : 'text-slate-600'">
          <template v-if="currentRun?.status === 'paid'">
            <strong>Locked</strong> — month paid, attendance change nahi hogi.
          </template>
          <template v-else-if="canEditAttendance">
            <strong>Edit mode ON</strong> — cell tap = menu (confirm ke baad save). Miss-touch safe.
          </template>
          <template v-else>
            <strong>View only</strong> — galat touch se kuchh change nahi hoga. Edit dabayein.
          </template>
        </div>
        <button
          v-if="currentRun?.status !== 'paid' && !canEditAttendance"
          type="button"
          class="pp-btn pp-btn-primary !py-2 shrink-0"
          @click="startAttendanceEdit"
        >
          ✏️ Edit attendance
        </button>
        <button
          v-else-if="canEditAttendance"
          type="button"
          class="pp-btn pp-btn-ghost !py-2 shrink-0 border-amber-400"
          @click="stopAttendanceEdit"
        >
          ✓ Done editing
        </button>
      </div>

      <p v-if="canEditAttendance" class="text-xs text-slate-500 px-1">
        Date tap = bulk select · <strong>✓all</strong> = sab present · Cell tap = action menu (har change confirm)
      </p>

      <div v-if="periodStaff.length > 0 && currentRun" class="flex flex-wrap gap-2 px-1">
        <button
          type="button"
          class="pp-btn pp-btn-success !py-1.5 !text-xs"
          @click="shareAllStaffHoursWhatsApp"
        >
          💬 WhatsApp hours (sab staff)
        </button>
      </div>

      <div v-if="periodStaff.length > 0 && canEditAttendance" class="pp-card p-3 flex flex-wrap gap-2 items-center">
        <span class="text-xs font-semibold text-slate-600 w-full sm:w-auto">Bulk (sab staff):</span>
        <button
          type="button"
          class="pp-btn pp-btn-primary !py-1.5 !text-xs"
          :disabled="!selectedBulkCount || currentRun?.status === 'paid'"
          @click="bulkMarkSelected('full')"
        >
          ✓ Sab Present ({{ selectedBulkCount }} din)
        </button>
        <button
          type="button"
          class="pp-btn pp-btn-ghost !py-1.5 !text-xs border-violet-200 text-violet-800"
          :disabled="!selectedBulkCount || currentRun?.status === 'paid'"
          @click="bulkMarkSelected('holiday')"
        >
          🏭 Holiday ({{ selectedBulkCount }} din)
        </button>
        <button
          type="button"
          class="pp-btn pp-btn-ghost !py-1.5 !text-xs border-indigo-200 text-indigo-800"
          :disabled="currentRun?.status === 'paid'"
          @click="bulkAllSundays"
        >
          ☀ Sab Sundays ({{ sundaysThisMonth.length }})
        </button>
      </div>

      <div v-if="periodStaff.length === 0" class="pp-card p-6 text-center text-slate-400">
        Is month ke liye koi staff nahi — pehle Staff tab se add karo, ya leaving date check karo.
      </div>
      <div v-else class="overflow-x-auto -mx-4 px-4">
        <table class="text-xs border-collapse min-w-max">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-white border border-slate-200 px-2 py-2 text-left min-w-[100px]">Staff</th>
              <th
                v-for="d in dayCols"
                :key="d"
                class="border border-slate-200 px-0.5 py-1 min-w-[36px] text-center align-top"
                :class="isSunday(selYear, selMonth, d) ? 'bg-indigo-50' : ''"
              >
                <button
                  v-if="canEditAttendance"
                  type="button"
                  class="block w-full text-[10px] font-semibold rounded px-0.5 py-0.5"
                  :class="isBulkDaySelected(d) ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-100'"
                  @click="toggleBulkDay(d)"
                >
                  {{ Number(d) }}
                </button>
                <span v-else class="block text-[10px] font-semibold text-slate-500 py-0.5">{{ Number(d) }}</span>
                <button
                  v-if="canEditAttendance"
                  type="button"
                  class="block w-full text-[9px] text-emerald-700 font-bold mt-0.5 hover:underline"
                  title="Sab staff present"
                  @click.stop="bulkPresentOneDay(d)"
                >
                  ✓all
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in periodStaff" :key="s.id">
              <td class="sticky left-0 z-10 bg-white border border-slate-200 px-2 py-2 font-semibold text-navy max-w-[140px]">
                <div class="flex items-center gap-1 min-w-0">
                  <span class="truncate">{{ s.name }}</span>
                  <button
                    type="button"
                    class="shrink-0 text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    title="WhatsApp par day-wise hours bhejein"
                    @click="shareStaffHoursWhatsApp(s.id)"
                  >
                    💬
                  </button>
                </div>
              </td>
              <td
                v-for="d in dayCols"
                :key="d"
                class="border border-slate-200 p-0.5"
                :class="isSunday(selYear, selMonth, d) ? 'bg-indigo-50/50' : ''"
              >
                <button
                  v-if="canEditAttendance"
                  type="button"
                  class="min-w-8 h-8 px-0.5 rounded text-[9px] font-bold flex items-center justify-center"
                  :class="dayCellClass(dayFor(s.id, d))"
                  @click="openDayActionMenu(s.id, d)"
                >
                  {{ dayCellLabel(dayFor(s.id, d)) }}
                </button>
                <span
                  v-else
                  class="min-w-8 h-8 px-0.5 rounded text-[9px] font-bold flex items-center justify-center"
                  :class="dayCellClass(dayFor(s.id, d))"
                >
                  {{ dayCellLabel(dayFor(s.id, d)) }}
                </span>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="bg-emerald-50 border-t-2 border-emerald-200">
              <td class="sticky left-0 z-10 bg-emerald-50 border border-slate-200 px-2 py-2 font-bold text-emerald-900 text-[10px] leading-tight">
                Salary expense<br><span class="font-normal text-emerald-700">(per day)</span>
              </td>
              <td
                v-for="d in dayCols"
                :key="'exp-' + d"
                class="border border-slate-200 px-0.5 py-1 text-center align-middle min-w-[36px]"
                :class="isSunday(selYear, selMonth, d) ? 'bg-emerald-100/80' : ''"
                :title="daySalaryExpense[d] > 0 ? `Din ${Number(d)} — sab staff: ₹${daySalaryExpense[d].toLocaleString('en-IN')}` : ''"
              >
                <span
                  class="block text-[9px] font-bold leading-tight"
                  :class="daySalaryExpense[d] > 0 ? 'text-emerald-800' : 'text-slate-300'"
                >
                  {{ fmtDaySalaryExpense(daySalaryExpense[d]) }}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div
        v-if="periodStaff.length > 0 && attendanceSalaryExpenseTotal > 0"
        class="pp-card p-3 flex flex-wrap items-center justify-between gap-2 bg-emerald-50 border-emerald-200"
      >
        <span class="text-xs text-emerald-800">
          Marked days ka total salary expense ({{ periodLabel(period) }})
        </span>
        <span class="font-bold text-emerald-900">₹{{ attendanceSalaryExpenseTotal.toLocaleString('en-IN') }}</span>
      </div>
      <p v-if="periodStaff.length > 0" class="text-[10px] text-slate-400 px-1">
        Har din = paid hours × hourly wage. Sunday weekly off unpaid (÷26 me pehle se); Sunday par duty/OT ho to pay milega.
      </p>
    </section>

    <!-- SALARY -->
    <section v-else-if="tab === 'salary'" class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <button class="pp-btn pp-btn-ghost" :disabled="currentRun?.status === 'paid'" @click="recalculate">Recalculate</button>
        <button
          v-if="currentRun"
          type="button"
          class="pp-btn pp-btn-success !py-2"
          @click="shareAllStaffHoursWhatsApp"
        >
          💬 WhatsApp hours (sab)
        </button>
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
                <th class="text-right px-2 py-2">Net</th>
                <th class="text-right px-2 py-2">Paid</th>
                <th class="text-right px-2 py-2">Balance</th>
                <th class="text-right px-3 py-2">Pay</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in currentRun.lines" :key="line.staff_id" class="border-t border-slate-100">
                <td class="px-3 py-2 font-semibold">
                  <div class="flex items-center gap-1">
                    <span>{{ line.staff_name }}</span>
                    <button
                      type="button"
                      class="text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                      title="WhatsApp par hours bhejein"
                      @click="shareStaffHoursWhatsApp(line.staff_id)"
                    >
                      💬
                    </button>
                  </div>
                </td>
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
                <td class="px-2 py-2 text-right text-emerald-700">₹{{ (line.paid_amount || 0).toLocaleString('en-IN') }}</td>
                <td class="px-2 py-2 text-right font-semibold text-amber-800">₹{{ lineBalanceDue(line).toLocaleString('en-IN') }}</td>
                <td class="px-3 py-2 text-right">
                  <span v-if="line.pay_status === 'paid'" class="text-xs text-emerald-700 font-semibold">Done</span>
                  <button
                    v-else-if="lineBalanceDue(line) > 0"
                    type="button"
                    class="pp-btn pp-btn-primary !py-1 !px-2 text-xs"
                    @click="openStaffPay(line.staff_id, lineBalanceDue(line))"
                  >
                    Pay
                  </button>
                  <span v-else class="text-xs text-slate-400">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="currentRun.status !== 'paid'" class="pp-card p-4 space-y-3">
          <h3 class="font-bold text-navy">Pay all remaining (combined voucher → 5101)</h3>
          <p class="text-xs text-slate-500">Har staff ka alag amount upar Pay se bhi record kar sakte ho. Sab clear hone par combined voucher post hoga.</p>
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
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <button class="pp-btn pp-btn-primary" @click="openAdvance">+ Record advance</button>
        <p class="text-xs text-slate-500">Salary day tak ke advances ({{ salaryCycleStartDate(salaryDate) }} se {{ salaryDate }}) is month ki salary me adjust honge.</p>
      </div>
      <div v-if="cycleAdvances.length === 0" class="pp-card p-6 text-center text-slate-400">Is salary cycle me koi advance nahi.</div>
      <div v-for="a in cycleAdvances" :key="a.id" class="pp-card p-3 flex justify-between gap-2 flex-wrap text-sm">
        <div>
          <span class="font-semibold text-navy">{{ a.staff_name }}</span>
          <span class="text-slate-500 ml-2">{{ a.date }}</span>
          <span v-if="a.applied_period" class="ml-2 text-xs font-medium text-emerald-700">{{ advanceAdjustedInLabel(a.applied_period) }}</span>
          <div class="text-xs text-slate-400">{{ a.mode }} · {{ a.narration || '—' }} · Month {{ advancePayrollPeriod(a) }}</div>
        </div>
        <div class="text-right flex flex-col items-end gap-1">
          <div class="font-bold">₹{{ a.amount.toLocaleString('en-IN') }}</div>
          <span v-if="!a.applied_period" class="text-xs text-amber-600">Pending adjust in {{ periodLabel(period) }} salary</span>
          <div v-if="!a.applied_period" class="flex gap-1">
            <button type="button" class="pp-btn pp-btn-ghost !py-1 !px-2 text-xs" @click="openEditAdvance(a)">Edit</button>
            <button type="button" class="pp-btn pp-btn-danger !py-1 !px-2 text-xs" @click="deleteAdvance(a.id)">Delete</button>
          </div>
        </div>
      </div>
    </section>

    <!-- LEDGER -->
    <section v-else-if="tab === 'ledger'" class="space-y-3">
      <div class="flex flex-wrap gap-2 items-center">
        <label class="text-sm font-semibold text-slate-600">Staff</label>
        <select v-model="ledgerStaffId" class="pp-input max-w-xs">
          <option v-for="s in store.staffList" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div v-if="!staffLedger" class="pp-card p-6 text-center text-slate-400">Staff select karein.</div>
      <template v-else>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div class="pp-card p-3 text-center"><div class="text-xs text-slate-500">Earned</div><div class="font-bold">₹{{ staffLedger.totals.earned.toLocaleString('en-IN') }}</div></div>
          <div class="pp-card p-3 text-center"><div class="text-xs text-slate-500">Advances</div><div class="font-bold text-amber-700">₹{{ staffLedger.totals.advancesGiven.toLocaleString('en-IN') }}</div></div>
          <div class="pp-card p-3 text-center"><div class="text-xs text-slate-500">Paid</div><div class="font-bold text-emerald-700">₹{{ staffLedger.totals.paid.toLocaleString('en-IN') }}</div></div>
        </div>
        <div class="pp-card p-3 text-sm text-slate-600">
          Balance due (company owes staff): <strong class="text-navy">₹{{ staffLedger.totals.balanceDue.toLocaleString('en-IN') }}</strong>
        </div>
        <div class="pp-card overflow-x-auto">
          <table class="w-full text-sm min-w-[640px]">
            <thead class="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th class="text-left px-3 py-2">Date</th>
                <th class="text-left px-3 py-2">Particulars</th>
                <th class="text-right px-2 py-2">Debit</th>
                <th class="text-right px-2 py-2">Credit</th>
                <th class="text-right px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in staffLedger.rows" :key="row.id" class="border-t border-slate-100">
                <td class="px-3 py-2 text-xs">{{ row.date }}</td>
                <td class="px-3 py-2">{{ row.label }}</td>
                <td class="px-2 py-2 text-right text-amber-700">{{ row.debit ? `₹${row.debit.toLocaleString('en-IN')}` : '—' }}</td>
                <td class="px-2 py-2 text-right text-emerald-700">{{ row.credit ? `₹${row.credit.toLocaleString('en-IN')}` : '—' }}</td>
                <td class="px-3 py-2 text-right font-semibold">₹{{ row.balance.toLocaleString('en-IN') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <!-- PAYSLIP -->
    <section v-else-if="tab === 'payslip'" class="space-y-4">
      <div class="flex flex-wrap gap-2 items-center print:hidden">
        <select v-model="payslipStaffId" class="pp-input max-w-xs">
          <option v-for="s in periodStaff" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button class="pp-btn pp-btn-ghost" @click="printPayslip">Print payslip</button>
        <button class="pp-btn pp-btn-primary" @click="downloadCurrentPayslipPdf">PDF</button>
        <button class="pp-btn pp-btn-success" @click="downloadAllPayslipsPdf">All Payslips PDF</button>
        <button
          v-if="payslipStaffId"
          type="button"
          class="pp-btn pp-btn-success"
          @click="shareStaffHoursWhatsApp(payslipStaffId)"
        >
          💬 WhatsApp hours
        </button>
      </div>
      <div v-if="!payslipLine" class="pp-card p-6 text-center text-slate-400">No salary data for this month.</div>
      <div v-else id="payslip-print" class="pp-card p-6 max-w-md mx-auto border-2 border-slate-200">
        <div class="text-center border-b border-slate-200 pb-3 mb-3">
          <div class="font-bold text-lg text-navy">{{ firmStore.activeFirm?.name || 'Firm' }}</div>
          <div class="text-sm text-slate-500">Payslip — {{ periodLabel(period) }}</div>
          <div v-if="salaryDate" class="text-xs text-slate-400">Salary day: {{ salaryDate }} · Advances {{ salaryCycleStartDate(salaryDate) }} → {{ salaryDate }}</div>
        </div>
        <div class="space-y-1 text-sm mb-4">
          <div><span class="text-slate-500">Employee:</span> <strong>{{ payslipLine.staff_name }}</strong></div>
          <div><span class="text-slate-500">Type:</span> {{ payrollPayTypeLabel(payslipLine.pay_type) }}</div>
          <div><span class="text-slate-500">Duty hours:</span> {{ payslipLine.total_duty_hours ?? 0 }}</div>
          <div><span class="text-slate-500">Off unpaid:</span> {{ payslipLine.total_off_unpaid_hours ?? 0 }} hr</div>
          <div><span class="text-slate-500">OT hours:</span> {{ payslipLine.total_ot_hours ?? 0 }}</div>
          <div><span class="text-slate-500">Paid hours:</span> {{ payslipLine.total_paid_hours ?? 0 }}</div>
          <div class="text-xs text-slate-400">Days: {{ payslipLine.days_present }} present · {{ payslipLine.days_half }} partial · {{ payslipLine.days_absent }} absent · {{ payslipLine.days_leave }} leave</div>
        </div>
        <table class="w-full text-sm border-t border-slate-200">
          <tbody>
            <tr><td class="py-2">Gross earned</td><td class="py-2 text-right font-semibold">₹{{ payslipLine.earned.toLocaleString('en-IN') }}</td></tr>
            <template v-if="payslipLine.advance_items?.length">
              <tr v-for="adv in payslipLine.advance_items" :key="adv.advance_id">
                <td class="py-2 text-amber-700">Advance {{ adv.date }}<span v-if="adv.narration" class="text-slate-400"> · {{ adv.narration }}</span></td>
                <td class="py-2 text-right">− ₹{{ adv.amount.toLocaleString('en-IN') }}</td>
              </tr>
              <tr v-if="payslipLine.advance_items.length > 1">
                <td class="py-2 font-semibold text-amber-800">Total advance</td>
                <td class="py-2 text-right font-semibold">− ₹{{ payslipLine.advance_deduction.toLocaleString('en-IN') }}</td>
              </tr>
            </template>
            <tr v-else-if="payslipLine.advance_deduction"><td class="py-2 text-amber-700">Advance deduction</td><td class="py-2 text-right">− ₹{{ payslipLine.advance_deduction.toLocaleString('en-IN') }}</td></tr>
            <tr v-if="payslipLine.other_deduction"><td class="py-2">Other deduction</td><td class="py-2 text-right">− ₹{{ payslipLine.other_deduction.toLocaleString('en-IN') }}</td></tr>
            <tr class="border-t-2 border-navy font-bold text-base"><td class="py-3">Net pay</td><td class="py-3 text-right text-emerald-800">₹{{ payslipLine.net_pay.toLocaleString('en-IN') }}</td></tr>
            <tr v-if="payslipLine.paid_amount"><td class="py-2 text-emerald-700">Paid</td><td class="py-2 text-right">₹{{ payslipLine.paid_amount.toLocaleString('en-IN') }}</td></tr>
            <tr v-if="lineBalanceDue(payslipLine) > 0"><td class="py-2 text-amber-800">Balance due</td><td class="py-2 text-right font-bold">₹{{ lineBalanceDue(payslipLine).toLocaleString('en-IN') }}</td></tr>
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
        <div>
          <label class="pp-label">Leaving date</label>
          <input v-model="staffForm.leaving_date" type="date" class="pp-input" />
          <p class="text-xs text-slate-500 mt-1">
            Staff chhodkar gaya ho to last working day daalo. Us month tak payroll me rahega, next month se hide.
          </p>
        </div>
        <label v-if="!staffForm.leaving_date" class="flex items-center gap-2 text-sm">
          <input v-model="staffForm.is_active" type="checkbox" /> Active
        </label>
        <p v-else class="text-xs text-rose-600">
          Leaving date set — staff inactive; {{ staffForm.leaving_date.slice(0, 7) }} ke baad payroll me nahi dikhega.
        </p>
        <div class="flex justify-end gap-2 pt-2">
          <button class="pp-btn pp-btn-ghost" @click="showStaffModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="saveStaff">Save</button>
        </div>
      </div>
    </PpModal>

    <!-- Day action menu (confirm before save) -->
    <PpModal
      v-if="showDayActionModal"
      :title="`${dayActionStaffName} — ${Number(dayActionDay)}`"
      @close="showDayActionModal = false"
    >
      <p class="text-xs text-slate-500 mb-3">Kya mark karna hai? Har option par confirm aayega.</p>
      <div class="grid grid-cols-1 gap-2">
        <button type="button" class="pp-btn pp-btn-primary w-full justify-center" @click="applyStaffDayPreset('full')">
          ✓ Present — 8 hr duty
        </button>
        <button type="button" class="pp-btn pp-btn-ghost w-full justify-center border-rose-200 text-rose-700" @click="applyStaffDayPreset('absent')">
          ✗ Absent
        </button>
        <button type="button" class="pp-btn pp-btn-ghost w-full justify-center border-violet-200 text-violet-800" @click="applyStaffDayPreset('holiday')">
          🏭 Holiday (paid)
        </button>
        <button type="button" class="pp-btn pp-btn-ghost w-full justify-center border-indigo-200 text-indigo-800" @click="applyStaffDayPreset('sunday')">
          ☀ Weekly off (unpaid, ÷26)
        </button>
        <button type="button" class="pp-btn pp-btn-ghost w-full justify-center" @click="openPartialFromActionMenu">
          ⏱ Partial duty / OT…
        </button>
        <button type="button" class="pp-btn pp-btn-danger w-full justify-center !py-2" @click="applyStaffDayPreset('clear')">
          Clear this day
        </button>
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
    <PpModal v-if="showAdvanceModal" :title="editingAdvanceId ? 'Edit advance' : 'Record advance'" @close="showAdvanceModal = false">
      <div class="space-y-3">
        <div>
          <label class="pp-label">Staff *</label>
          <select v-model="advanceForm.staff_id" class="pp-input" :disabled="!!editingAdvanceId">
            <option v-for="s in periodStaff" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div>
          <label class="pp-label">Salary month (adjust isi month me hoga)</label>
          <input v-model="advanceForm.payroll_period" type="month" class="pp-input" />
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

    <PpModal v-if="showStaffPayModal" title="Record salary payment" @close="showStaffPayModal = false">
      <div class="space-y-3">
        <p class="text-sm text-slate-600">Jo amount ab pay kar rahe ho woh yahan daalein — balance auto update hoga.</p>
        <div>
          <label class="pp-label">Amount ₹</label>
          <input v-model.number="staffPayAmount" type="number" min="1" class="pp-input text-lg font-bold" />
        </div>
        <div class="grid grid-cols-2 gap-3">
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
        </div>
        <div class="flex justify-end gap-2">
          <button class="pp-btn pp-btn-ghost" @click="showStaffPayModal = false">Cancel</button>
          <button class="pp-btn pp-btn-primary" @click="confirmStaffPay">Save payment</button>
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
