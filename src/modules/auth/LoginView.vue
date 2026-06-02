<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const mode = ref<'in' | 'up'>('in')
const msg = ref('')

const submitLabel = computed(() => {
  if (auth.loading) return mode.value === 'in' ? 'Signing in...' : 'Creating account...'
  return mode.value === 'in' ? 'Sign In' : 'Create Account'
})
const feedbackClass = computed(() => auth.error ? 'text-red-600' : 'text-green-700')

async function submit() {
  msg.value = ''
  auth.error = ''
  if (!email.value.trim() || !password.value) {
    msg.value = 'Email aur password dono bharein.'
    auth.error = msg.value
    return
  }
  const ok = mode.value === 'in'
    ? await auth.signIn(email.value, password.value)
    : await auth.signUp(email.value, password.value)
  if (ok) {
    msg.value = mode.value === 'up'
      ? 'Account ban gaya. Email confirm karke Sign In karein.'
      : `Sign in ho gaya: ${auth.user?.email || email.value}`
    if (mode.value === 'in') window.setTimeout(() => router.push('/dashboard'), 500)
  } else {
    msg.value = auth.error || auth.statusMessage || 'Sign in failed'
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

      <div v-if="auth.isLoggedIn" class="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-900 mb-4">
        <div class="font-semibold">Signed in</div>
        <div class="break-all">{{ auth.user?.email }}</div>
        <div class="text-xs mt-1">{{ auth.orgId ? 'Cloud sync ready.' : 'Organization setup pending. Settings me Setup Organization dabayein.' }}</div>
        <RouterLink to="/dashboard" class="block mt-2 text-accent font-semibold">Go to Dashboard →</RouterLink>
      </div>

      <div v-if="!auth.isConfigured" class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 mb-4">
        Supabase connect nahi hai.
        <RouterLink to="/settings" class="block mt-2 text-accent font-semibold">Settings → Cloud Sync</RouterLink>
        me URL + anon key paste karein → <strong>Save &amp; Connect</strong>, phir yahan login karein.
        <div class="text-xs mt-2">Mobile PWA me keys isi installed app ke storage me save hoti hain; reinstall/clear storage ke baad dobara paste karni padengi.</div>
        <RouterLink to="/dashboard" class="block mt-2 text-slate-600">Continue offline →</RouterLink>
      </div>

      <template v-else-if="!auth.isLoggedIn">
        <div class="flex gap-2 mb-4">
          <button :class="['flex-1 py-2 rounded-lg text-sm font-semibold', mode === 'in' ? 'bg-accent text-white' : 'bg-slate-100']" :disabled="auth.loading" @click="mode = 'in'">Sign In</button>
          <button :class="['flex-1 py-2 rounded-lg text-sm font-semibold', mode === 'up' ? 'bg-accent text-white' : 'bg-slate-100']" :disabled="auth.loading" @click="mode = 'up'">Sign Up</button>
        </div>
        <div class="space-y-3">
          <div><label class="pp-label">Email</label><input v-model.trim="email" type="email" class="pp-input" autocomplete="email" /></div>
          <div><label class="pp-label">Password</label><input v-model="password" type="password" class="pp-input" autocomplete="current-password" @keyup.enter="submit" /></div>
          <button class="pp-btn pp-btn-primary w-full" :disabled="auth.loading" @click="submit">
            {{ submitLabel }}
          </button>
          <p v-if="auth.loading || msg || auth.statusMessage" class="text-sm text-center" :class="feedbackClass">
            {{ auth.loading ? auth.statusMessage : (msg || auth.statusMessage) }}
          </p>
          <p class="text-xs text-center text-slate-500 leading-relaxed">
            Refresh ke baad bhi login rehna chahiye. Agar installed PWA purani ho, Chrome/Safari me app refresh/update karein.
          </p>
        </div>
      </template>

      <RouterLink to="/dashboard" class="block text-center text-sm text-slate-500 mt-6 hover:text-accent">← Back to app</RouterLink>
    </div>
  </div>
</template>
