<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { DayAttendance, Staff } from '@/types/models'
import {
  PAYROLL_HOURS_PER_DAY,
  dayFromPreset,
  isStaffEmployedOnDay,
  isSunday,
  normalizeDayHours,
} from '@/services/payrollCalc'
import type { PayrollLine } from '@/types/models'

const props = defineProps<{
  staff: Staff[]
  lines: PayrollLine[]
  year: number
  month: number
  dayCols: string[]
  editable: boolean
}>()

const emit = defineEmits<{
  save: [staffId: string, dayHours: Record<string, DayAttendance>]
  clearDay: [day: string]
}>()

const clearDayPick = ref('')

const segment = ref<'monthly' | 'daily_wage'>('monthly')
const feedStaffId = ref('')

type FeedRow = { duty: string; ot: string }

const draft = reactive<Record<string, FeedRow>>({})

const segmentStaff = computed(() =>
  props.staff
    .filter((s) => s.pay_type === segment.value)
    .slice()
    .sort((a, b) =>
      String(a.employee_code || '').localeCompare(String(b.employee_code || ''))
      || a.name.localeCompare(b.name),
    ),
)

const feedStaff = computed(() => segmentStaff.value.find((s) => s.id === feedStaffId.value))

function lineFor(staffId: string) {
  return props.lines.find((l) => l.staff_id === staffId)
}

function loadDraft(staffId: string) {
  for (const key of Object.keys(draft)) delete draft[key]
  const line = lineFor(staffId)
  const hours = line ? normalizeDayHours(line) : {}
  for (const d of props.dayCols) {
    const day = hours[d]
    if (!day || day.duty_hours === null) {
      draft[d] = { duty: '', ot: '' }
    } else {
      draft[d] = {
        duty: String(day.duty_hours),
        ot: day.ot_hours > 0 ? String(day.ot_hours) : '',
      }
    }
  }
}

watch(
  segmentStaff,
  (list) => {
    if (!list.length) {
      feedStaffId.value = ''
      return
    }
    if (!list.some((s) => s.id === feedStaffId.value)) {
      feedStaffId.value = list[0].id
    }
  },
  { immediate: true },
)

watch(
  () => [feedStaffId.value, props.lines, props.dayCols.join(',')] as const,
  () => {
    if (feedStaffId.value) loadDraft(feedStaffId.value)
  },
  { immediate: true },
)

function selectStaff(id: string) {
  feedStaffId.value = id
  nextTick(() => focusCell(props.dayCols[0], 'duty'))
}

function focusCell(day: string, field: 'duty' | 'ot') {
  const el = document.getElementById(`feed-${day}-${field}`) as HTMLInputElement | null
  if (!el || el.disabled) return
  el.focus()
  el.select()
}

function employed(day: string) {
  const staff = feedStaff.value
  if (!staff) return false
  return isStaffEmployedOnDay(staff, props.year, props.month, day)
}

function buildDayAttendance(day: string): DayAttendance | null {
  const row = draft[day] || { duty: '', ot: '' }
  const dutyRaw = row.duty.trim()
  if (dutyRaw === '') return null
  const duty = Math.max(0, Number(dutyRaw) || 0)
  const ot = Math.max(0, Number(row.ot) || 0)
  const sunday = isSunday(props.year, props.month, day)
  if (duty === 0 && ot === 0) {
    return sunday
      ? { ...dayFromPreset('sunday') }
      : { duty_hours: 0, off_paid: false, ot_hours: 0, kind: 'absent' }
  }
  if (duty === 0 && ot > 0) {
    return {
      duty_hours: 0,
      off_paid: sunday,
      ot_hours: ot,
      kind: sunday ? 'sunday' : 'work',
    }
  }
  return {
    duty_hours: duty,
    off_paid: false,
    ot_hours: ot,
    kind: sunday ? 'sunday' : 'work',
  }
}

async function commitStaffHours() {
  if (!props.editable || !feedStaffId.value) return
  const line = lineFor(feedStaffId.value)
  const hours = line ? { ...normalizeDayHours(line) } : {}
  for (const d of props.dayCols) {
    if (!employed(d)) {
      delete hours[d]
      continue
    }
    const built = buildDayAttendance(d)
    if (!built) delete hours[d]
    else hours[d] = built
  }
  emit('save', feedStaffId.value, hours)
}

function nextEmployedDay(fromDay: string): string | null {
  const idx = props.dayCols.indexOf(fromDay)
  for (let i = idx + 1; i < props.dayCols.length; i++) {
    if (employed(props.dayCols[i])) return props.dayCols[i]
  }
  return null
}

function prevEmployedDay(fromDay: string): string | null {
  const idx = props.dayCols.indexOf(fromDay)
  for (let i = idx - 1; i >= 0; i--) {
    if (employed(props.dayCols[i])) return props.dayCols[i]
  }
  return null
}

async function onDutyKeydown(day: string, e: KeyboardEvent) {
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    await commitStaffHours()
    focusCell(day, 'ot')
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    await commitStaffHours()
    focusCell(day, 'ot')
  }
}

async function onOtKeydown(day: string, e: KeyboardEvent) {
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    await commitStaffHours()
    const next = nextEmployedDay(day)
    if (next) focusCell(next, 'duty')
    else {
      // End of month → next staff in segment
      const list = segmentStaff.value
      const i = list.findIndex((s) => s.id === feedStaffId.value)
      if (i >= 0 && i < list.length - 1) {
        selectStaff(list[i + 1].id)
      }
    }
    return
  }
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault()
    focusCell(day, 'duty')
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    await commitStaffHours()
    const next = nextEmployedDay(day)
    if (next) focusCell(next, 'duty')
  }
}

async function onDutyKeydownShiftTab(day: string, e: KeyboardEvent) {
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault()
    const prev = prevEmployedDay(day)
    if (prev) focusCell(prev, 'ot')
  }
}

function quickFill(preset: 'full' | 'sunday' | 'holiday' | 'absent' | 'clear') {
  if (!props.editable || !feedStaff.value) return
  for (const d of props.dayCols) {
    if (!employed(d)) continue
    if (preset === 'clear') {
      draft[d] = { duty: '', ot: '' }
      continue
    }
    if (preset === 'sunday' && !isSunday(props.year, props.month, d)) continue
    if (preset === 'full') {
      draft[d] = { duty: String(PAYROLL_HOURS_PER_DAY), ot: draft[d]?.ot || '' }
    } else if (preset === 'sunday' || preset === 'holiday') {
      draft[d] = { duty: '0', ot: '' }
    } else if (preset === 'absent') {
      draft[d] = { duty: '0', ot: '' }
    }
  }
  void commitStaffHours()
}

function switchSegment(next: 'monthly' | 'daily_wage') {
  segment.value = next
}

function clearAllStaffOnDay(day: string) {
  if (!props.editable || !day) return
  emit('clearDay', day)
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="pp-btn !py-2"
        :class="segment === 'monthly' ? 'pp-btn-primary' : 'pp-btn-ghost'"
        @click="switchSegment('monthly')"
      >
        Monthly salary ({{ staff.filter((s) => s.pay_type === 'monthly').length }})
      </button>
      <button
        type="button"
        class="pp-btn !py-2"
        :class="segment === 'daily_wage' ? 'pp-btn-primary' : 'pp-btn-ghost'"
        @click="switchSegment('daily_wage')"
      >
        Daily wage ({{ staff.filter((s) => s.pay_type === 'daily_wage').length }})
      </button>
    </div>

    <p class="text-xs text-slate-600 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
      <strong>Keyboard feed:</strong> Duty → Tab → OT → Tab = next day (auto-save).
      Enter bhi same. Blank duty = unmarked (0 pay). Weekly off pe duty/OT = full daily + OT.
    </p>

    <div v-if="editable" class="pp-card p-3 flex flex-wrap items-end gap-2">
      <div class="min-w-[140px]">
        <label class="pp-label">Clear date — sab staff</label>
        <select v-model="clearDayPick" class="pp-input">
          <option value="">Din choose…</option>
          <option v-for="d in dayCols" :key="'clr-' + d" :value="d">
            {{ Number(d) }}{{ isSunday(year, month, d) ? ' (Sun)' : '' }}
          </option>
        </select>
      </div>
      <button
        type="button"
        class="pp-btn pp-btn-ghost !py-2 text-rose-700 border-rose-200"
        :disabled="!clearDayPick"
        @click="clearAllStaffOnDay(clearDayPick); clearDayPick = ''"
      >
        ✕ Us din sab clear
      </button>
    </div>

    <div v-if="!segmentStaff.length" class="pp-card p-6 text-center text-slate-400">
      Is segment me is month ka koi staff nahi.
    </div>

    <template v-else>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="s in segmentStaff"
          :key="s.id"
          type="button"
          class="pp-btn !py-1.5 !text-xs"
          :class="feedStaffId === s.id ? 'pp-btn-primary' : 'pp-btn-ghost'"
          @click="selectStaff(s.id)"
        >
          <span class="font-mono">{{ s.employee_code || '—' }}</span>
          · {{ s.name }}
        </button>
      </div>

      <div v-if="feedStaff && editable" class="flex flex-wrap gap-2">
        <button type="button" class="pp-btn pp-btn-ghost !py-1.5 !text-xs" @click="quickFill('full')">All 8h duty</button>
        <button type="button" class="pp-btn pp-btn-ghost !py-1.5 !text-xs border-indigo-200 text-indigo-800" @click="quickFill('sunday')">Sundays paid off</button>
        <button type="button" class="pp-btn pp-btn-ghost !py-1.5 !text-xs border-violet-200 text-violet-800" @click="quickFill('holiday')">Fill holiday (0+paid)</button>
        <button type="button" class="pp-btn pp-btn-ghost !py-1.5 !text-xs text-rose-700" @click="quickFill('clear')">Clear all</button>
      </div>

      <div v-if="feedStaff" class="pp-card overflow-hidden">
        <div class="px-3 py-2 border-b bg-slate-50 flex flex-wrap items-center gap-2 justify-between">
          <div class="font-semibold text-navy">
            <span class="font-mono text-sky-800">{{ feedStaff.employee_code || '—' }}</span>
            · {{ feedStaff.name }}
          </div>
          <div class="text-xs text-slate-500">
            {{ segment === 'monthly' ? 'Monthly' : 'Daily wage' }} · Duty + OT
          </div>
        </div>

        <div class="overflow-x-auto max-h-[70vh]">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-white z-10">
              <tr class="border-b text-xs text-slate-500">
                <th class="text-left px-3 py-2 w-20">Day</th>
                <th class="text-left px-3 py-2 w-28">Duty (h)</th>
                <th class="text-left px-3 py-2 w-28">OT (h)</th>
                <th class="text-left px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in dayCols"
                :key="d"
                class="border-b border-slate-100"
                :class="[
                  isSunday(year, month, d) ? 'bg-indigo-50/60' : '',
                  !employed(d) ? 'bg-slate-100 opacity-60' : '',
                ]"
              >
                <td class="px-3 py-1.5 font-semibold tabular-nums">
                  <div class="flex items-center gap-1">
                    <span>{{ Number(d) }}</span>
                    <span v-if="isSunday(year, month, d)" class="text-[10px] text-indigo-700">Sun</span>
                    <button
                      v-if="editable"
                      type="button"
                      class="text-[10px] text-rose-600 hover:underline ml-1"
                      title="Is din sab staff clear"
                      @click="clearAllStaffOnDay(d)"
                    >
                      ✕all
                    </button>
                  </div>
                </td>
                <td class="px-2 py-1">
                  <input
                    v-if="employed(d) && editable"
                    :id="`feed-${d}-duty`"
                    v-model="draft[d].duty"
                    type="number"
                    min="0"
                    step="0.5"
                    inputmode="decimal"
                    class="pp-input !py-1.5 !text-sm font-mono w-full"
                    placeholder="—"
                    @keydown="onDutyKeydown(d, $event); onDutyKeydownShiftTab(d, $event)"
                    @blur="commitStaffHours"
                  />
                  <span v-else class="text-slate-400 px-2">{{ employed(d) ? (draft[d]?.duty || '—') : '—' }}</span>
                </td>
                <td class="px-2 py-1">
                  <input
                    v-if="employed(d) && editable"
                    :id="`feed-${d}-ot`"
                    v-model="draft[d].ot"
                    type="number"
                    min="0"
                    step="0.5"
                    inputmode="decimal"
                    class="pp-input !py-1.5 !text-sm font-mono w-full"
                    placeholder="0"
                    @keydown="onOtKeydown(d, $event)"
                    @blur="commitStaffHours"
                  />
                  <span v-else class="text-slate-400 px-2">{{ employed(d) ? (draft[d]?.ot || '—') : '—' }}</span>
                </td>
                <td class="px-3 py-1.5 text-xs text-slate-500">
                  <template v-if="!employed(d)">Outside join/leave</template>
                  <template v-else-if="isSunday(year, month, d) && draft[d]?.duty === '0'">Sunday paid off</template>
                  <template v-else-if="draft[d]?.duty === ''">Unmarked</template>
                  <template v-else>Work</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
