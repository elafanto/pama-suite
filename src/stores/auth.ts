import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getSupabase, supabaseConfigured } from '@/services/supabase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<{ id: string; email: string } | null>(null)
  const orgId = ref<string | null>(localStorage.getItem('pama_org_id'))
  const loading = ref(false)
  const error = ref('')

  const isConfigured = computed(() => supabaseConfigured)
  const isLoggedIn = computed(() => !!user.value)
  const canSync = computed(() => supabaseConfigured && !!user.value && !!orgId.value)

  async function init() {
    const sb = getSupabase()
    if (!sb) return
    loading.value = true
    try {
      const sessionResult = await Promise.race([
        sb.auth.getSession(),
        new Promise<{ data: { session: null }; error: null }>((resolve) =>
          setTimeout(() => resolve({ data: { session: null }, error: null }), 8000),
        ),
      ])
      const { data } = sessionResult
      if (data?.session?.user) {
        user.value = { id: data.session.user.id, email: data.session.user.email || '' }
        await loadOrg()
      }
      sb.auth.onAuthStateChange((_e, session) => {
        if (session?.user) {
          user.value = { id: session.user.id, email: session.user.email || '' }
          loadOrg()
        } else {
          user.value = null
          orgId.value = null
          localStorage.removeItem('pama_org_id')
        }
      })
    } finally {
      loading.value = false
    }
  }

  async function loadOrg() {
    const sb = getSupabase()
    if (!sb || !user.value) return
    const { data: prof } = await sb.from('profiles').select('org_id').eq('id', user.value.id).maybeSingle()
    if (prof?.org_id) {
      orgId.value = prof.org_id
      localStorage.setItem('pama_org_id', prof.org_id)
      return
    }
    // First login: create org + profile
    const { data: org, error: orgErr } = await sb.from('orgs').insert({ name: 'Pama Packaging' }).select().single()
    if (orgErr || !org) return
    await sb.from('org_members').insert({ org_id: org.id, user_id: user.value.id, role: 'owner' })
    await sb.from('profiles').upsert({ id: user.value.id, org_id: org.id, display_name: user.value.email.split('@')[0] })
    orgId.value = org.id
    localStorage.setItem('pama_org_id', org.id)
  }

  async function signIn(email: string, password: string) {
    error.value = ''
    const sb = getSupabase()
    if (!sb) { error.value = 'Supabase not configured — add .env.local'; return false }
    loading.value = true
    try {
      const { data: sessionData, error: err } = await sb.auth.signInWithPassword({ email, password })
      if (err) { error.value = err.message; return false }
      if (sessionData.session?.user) {
        user.value = { id: sessionData.session.user.id, email: sessionData.session.user.email || '' }
        await loadOrg()
      }
      return true
    } finally {
      loading.value = false
    }
  }

  async function signUp(email: string, password: string) {
    error.value = ''
    const sb = getSupabase()
    if (!sb) { error.value = 'Supabase not configured'; return false }
    loading.value = true
    try {
      const { error: err } = await sb.auth.signUp({ email, password })
      if (err) { error.value = err.message; return false }
      return true
    } finally {
      loading.value = false
    }
  }

  async function signOut() {
    const sb = getSupabase()
    await sb?.auth.signOut()
    user.value = null
    orgId.value = null
    localStorage.removeItem('pama_org_id')
  }

  return { user, orgId, loading, error, isConfigured, isLoggedIn, canSync, init, signIn, signUp, signOut }
})
