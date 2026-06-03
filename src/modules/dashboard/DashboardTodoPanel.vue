<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFirmStore } from '@/stores/firm'
import {
  addDashboardTodo,
  listDashboardTodos,
  removeDashboardTodo,
  toggleDashboardTodo,
} from '@/services/dashboardTodos'
import type { DashboardTodo } from '@/types/models'

const firmStore = useFirmStore()
const todos = ref<DashboardTodo[]>([])
const newText = ref('')
const loading = ref(false)

const pendingCount = computed(() => todos.value.filter((t) => !t.completed).length)

async function load() {
  const firmId = firmStore.activeFirmId
  if (!firmId) {
    todos.value = []
    return
  }
  loading.value = true
  try {
    todos.value = await listDashboardTodos(firmId)
  } finally {
    loading.value = false
  }
}

watch(() => firmStore.activeFirmId, load, { immediate: true })

async function addTodo() {
  const text = newText.value.trim()
  if (!text || !firmStore.activeFirmId) return
  await addDashboardTodo(firmStore.activeFirmId, text)
  newText.value = ''
  await load()
}

async function onToggle(todo: DashboardTodo) {
  await toggleDashboardTodo(todo.id, !todo.completed)
  await load()
}

async function onDelete(id: string) {
  await removeDashboardTodo(id)
  await load()
}
</script>

<template>
  <aside class="pp-card flex flex-col min-h-[280px] sm:min-h-[360px] lg:min-h-[calc(100vh-5rem)] lg:max-h-[calc(100vh-5rem)] border-l-4 border-accent">
    <div class="p-4 border-b border-slate-100 shrink-0">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-bold text-navy">To-Do List</h2>
        <span
          v-if="pendingCount"
          class="text-xs font-bold px-2.5 py-1 rounded-full bg-accent/15 text-accent"
        >
          {{ pendingCount }} pending
        </span>
        <span v-else class="text-xs text-slate-400">All done</span>
      </div>
      <form class="mt-3 flex gap-2" @submit.prevent="addTodo">
        <input
          v-model="newText"
          type="text"
          class="pp-input flex-1 text-sm"
          placeholder="Add a task…"
          maxlength="500"
          :disabled="!firmStore.activeFirmId"
        />
        <button
          type="submit"
          class="pp-btn pp-btn-primary shrink-0 !px-3"
          :disabled="!newText.trim() || !firmStore.activeFirmId"
        >
          Add
        </button>
      </form>
    </div>

    <div class="flex-1 overflow-y-auto p-3 min-h-[200px]">
      <p v-if="loading" class="text-sm text-slate-400 text-center py-8">Loading…</p>
      <p v-else-if="!todos.length" class="text-sm text-slate-400 text-center py-8">
        No tasks yet. Add one above.
      </p>
      <ul v-else class="space-y-2">
        <li
          v-for="todo in todos"
          :key="todo.id"
          class="flex items-start gap-2 p-2.5 rounded-lg border border-slate-100 bg-slate-50/80 hover:bg-white transition"
          :class="todo.completed ? 'opacity-70' : ''"
        >
          <input
            type="checkbox"
            class="mt-1 w-4 h-4 rounded border-slate-300 text-accent focus:ring-accent shrink-0"
            :checked="todo.completed"
            @change="onToggle(todo)"
          />
          <span
            class="flex-1 text-sm text-navy break-words"
            :class="todo.completed ? 'line-through text-slate-500' : ''"
          >
            {{ todo.text }}
          </span>
          <button
            type="button"
            class="text-slate-400 hover:text-red-600 text-xs font-semibold shrink-0 px-1"
            title="Delete"
            @click="onDelete(todo.id)"
          >
            ✕
          </button>
        </li>
      </ul>
    </div>
  </aside>
</template>
