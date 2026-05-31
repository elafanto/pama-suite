<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const mode = ref<'in' | 'up'>('in')
const msg = ref('')

async function submit() {
  msg.value = ''
  const ok = mode.value === 'in'
    ? await auth.signIn(email.value, password.value)
    : await auth.signUp(email.value, password.value)
  if (ok) {
    msg.value = mode.value === 'up' ? 'Check email to confirm, then sign in.' : 'Welcome!'
    if (mode.value === 'in') router.push('/dashboard')
  } else {
    msg.value = auth.error
  }
}
</script>

<template>
  <div class="min-h-screen bg-navy flex items-center justify-center p-4">
    <div class="pp-card w-full max-w-md p-8">
      <div class="text-center mb-6">
        <div class="text-4xl mb-2">🏭</div>
        <h1 class="text-xl font-bold text-navy">Pama Business Suite</h1>
        <p class="text-sm text-slate-500 mt-1">Cloud login (optional — local data works without account)</p>
      </div>

      <div v-if="!auth.isConfigured" class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 mb-4">
        Supabase not configured. Copy <code class="bg-white px-1 rounded">.env.example</code> → <code>.env.local</code> and add your project keys.
        <RouterLink to="/dashboard" class="block mt-2 text-accent font-semibold">Continue offline →</RouterLink>
      </div>

      <template v-else>
        <div class="flex gap-2 mb-4">
          <button :class="['flex-1 py-2 rounded-lg text-sm font-semibold', mode === 'in' ? 'bg-accent text-white' : 'bg-slate-100']" @click="mode = 'in'">Sign In</button>
          <button :class="['flex-1 py-2 rounded-lg text-sm font-semibold', mode === 'up' ? 'bg-accent text-white' : 'bg-slate-100']" @click="mode = 'up'">Sign Up</button>
        </div>
        <div class="space-y-3">
          <div><label class="pp-label">Email</label><input v-model="email" type="email" class="pp-input" /></div>
          <div><label class="pp-label">Password</label><input v-model="password" type="password" class="pp-input" /></div>
          <button class="pp-btn pp-btn-primary w-full" :disabled="auth.loading" @click="submit">
            {{ mode === 'in' ? 'Sign In' : 'Create Account' }}
          </button>
          <p v-if="msg" class="text-sm text-center" :class="auth.error ? 'text-red-600' : 'text-green-600'">{{ msg }}</p>
        </div>
      </template>

      <RouterLink to="/dashboard" class="block text-center text-sm text-slate-500 mt-6 hover:text-accent">← Back to app</RouterLink>
    </div>
  </div>
</template>
