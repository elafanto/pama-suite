import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getSupabase, supabaseConfigured, isVercelDeploy } from '@/services/supabase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<{ id: string; email: string } | null>(null)
  const orgId = ref<string | null>(localStorage.getItem('pama_org_id'))
  const loading = ref(false)
  const error = ref('')

  const isConfigured = computed(() => supabaseConfigured)
  const isLoggedIn = computed(() => !!user.value)
  const canSync = computed(() => supabaseConfigured && !!user.value && !!orgId.value)

  /** Human-readable reason sync is blocked; null when sync is allowed. */
  const syncBlockReason = computed((): string | null => {
    if (!supabaseConfigured) {
      if (isVercelDeploy()) {
        return 'Supabase keys missing on this Vercel site.\n\nFix: Vercel Dashboard → your project → Settings → Environment Variables → add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (from Supabase Dashboard → Settings → API), then Redeploy.\n\nNote: Vite bakes env vars at build time — adding vars alone is not enough; you must redeploy.'
      }
      return 'Supabase keys missing locally.\n\nFix: copy .env.example to .env.local, add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart npm run dev.'
    }
    if (!user.value) {
      return 'Sign in required for cloud sync.\n\nGo to Login (/login) and sign in with your Supabase account.'
    }
    if (!orgId.value) {
      return 'Organization not ready yet.\n\nWait a few seconds after login, or sign out and sign in again. First login creates your org automatically.'
    }
    return null
  })

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
    if (!sb) {
      error.value = isVercelDeploy()
        ? 'Supabase not configured on this site — add VITE_* keys in Vercel env vars and redeploy'
        : 'Supabase not configured — copy .env.example to .env.local and restart dev server'
      return false
    }
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
    if (!sb) {
      error.value = isVercelDeploy()
        ? 'Supabase not configured on this site — add VITE_* keys in Vercel env vars and redeploy'
        : 'Supabase not configured — copy .env.example to .env.local and restart dev server'
      return false
    }
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

  return { user, orgId, loading, error, isConfigured, isLoggedIn, canSync, syncBlockReason, init, signIn, signUp, signOut }
})
