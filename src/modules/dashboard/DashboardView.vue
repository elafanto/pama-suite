<script setup lang="ts">
import { RouterLink } from 'vue-router'

const tools = [
  { to: '/billing',   icon: '🧾', name: 'Billing',    desc: 'GST invoices & sales',  color: 'bg-emerald-100' },
  { to: '/purchases', icon: '📥', name: 'Purchases',  desc: 'Vendor bills & stock',  color: 'bg-blue-100' },
  { to: '/boxcalc',   icon: '🧮', name: 'BoxCalc',    desc: 'Corrugated costing',    color: 'bg-indigo-100' },
  { to: '/banking',   icon: '🏦', name: 'Banking',    desc: 'RTGS / NEFT emails',    color: 'bg-orange-100' },
  { to: '/accounting',icon: '📊', name: 'Accounting', desc: 'Ledger & reports',      color: 'bg-violet-100' },
  { to: '/parties',   icon: '👥', name: 'Parties',    desc: 'Customers & vendors',   color: 'bg-cyan-100' },
]
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto">
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-navy">Dashboard</h1>
      <p class="text-sm text-slate-500 mt-1">Welcome to Pama Business Suite</p>
    </header>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <RouterLink v-for="t in tools" :key="t.to" :to="t.to"
        class="pp-card p-5 flex items-start gap-4 hover:shadow-card-lg hover:-translate-y-0.5 transition">
        <div :class="['w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0', t.color]">{{ t.icon }}</div>
        <div>
          <h2 class="font-bold text-navy">{{ t.name }}</h2>
          <p class="text-sm text-slate-500">{{ t.desc }}</p>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
