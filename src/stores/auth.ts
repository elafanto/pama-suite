import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getSupabase,
  isSupabaseConfigured,
  isHostedDeploy,
  saveSupabaseKeys,
  resetSupabaseClient,
} from '@/services/supabase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<{ id: string; email: string } | null>(null)
  const orgId = ref<string | null>(localStorage.getItem('pama_org_id'))
  const loading = ref(false)
  const error = ref('')
  const orgSetupError = ref('')
  /** Bump after manual key save so computed isConfigured refreshes. */
  const configVersion = ref(0)

  const isConfigured = computed(() => {
    configVersion.value
    return isSupabaseConfigured()
  })
  const isLoggedIn = computed(() => !!user.value)
  const canSync = computed(() => isConfigured.value && !!user.value && !!orgId.value)

  async function applySupabaseKeys(url: string, anon: string): Promise<boolean> {
    if (!url.trim() || !anon.trim()) {
      error.value = 'URL aur anon key dono bhari honi chahiye'
      return false
    }
    saveSupabaseKeys(url, anon)
    configVersion.value++
    resetSupabaseClient()
    await init()
    return isSupabaseConfigured()
  }

  /** Human-readable reason sync is blocked; null when sync is allowed. */
  const syncBlockReason = computed((): string | null => {
    configVersion.value
    if (!isSupabaseConfigured()) {
      if (isHostedDeploy()) {
        return 'Supabase connect nahi hai.\n\nOption A (recommended): Neeche Settings me URL + anon key paste karein → Save & Connect.\n\nOption B: Vercel → Environment Variables → VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY → Redeploy.'
      }
      return 'Supabase connect nahi hai.\n\nOption A: Neeche URL + anon key paste karein → Save & Connect.\n\nOption B: .env.local me keys → npm run dev restart.'
    }
    if (!user.value) {
      return 'Sign in required for cloud sync.\n\nGo to Login (/login) and sign in with your Supabase account.'
    }
    if (!orgId.value) {
      if (orgSetupError.value) {
        return `Organization setup failed:\n\n${orgSetupError.value}\n\nFix: Supabase → SQL Editor → run supabase/migrations/003_bootstrap_user_org.sql\n\nPhir Settings me "Setup Organization" dabayein.`
      }
      return 'Organization not ready yet.\n\nSettings → Cloud Sync → "Setup Organization" dabayein.\n\nAgar error aaye to Supabase SQL migration 003 run karein (see SETUP.md).'
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

  async function loadOrg(): Promise<boolean> {
    const sb = getSupabase()
    if (!sb || !user.value) return false
    orgSetupError.value = ''

    const { data: prof, error: profErr } = await sb
      .from('profiles')
      .select('org_id')
      .eq('id', user.value.id)
      .maybeSingle()

    if (profErr) {
      orgSetupError.value = profErr.message
      orgId.value = null
      localStorage.removeItem('pama_org_id')
      return false
    }

    if (prof?.org_id) {
      orgId.value = prof.org_id
      localStorage.setItem('pama_org_id', prof.org_id)
      return true
    }

    orgId.value = null
    localStorage.removeItem('pama_org_id')

    const displayName = user.value.email.split('@')[0] || 'User'
    const { data: bootId, error: bootErr } = await sb.rpc('bootstrap_user_org', { display_name: displayName })

    if (!bootErr && bootId) {
      orgId.value = bootId as string
      localStorage.setItem('pama_org_id', bootId as string)
      return true
    }

    // Fallback if RPC not deployed yet (only migration 001/002)
    const { data: org, error: orgErr } = await sb.from('orgs').insert({ name: 'Pama Packaging' }).select().single()
    if (orgErr || !org) {
      orgSetupError.value = bootErr?.message || orgErr?.message || 'Could not create organization'
      return false
    }
    const { error: memErr } = await sb.from('org_members').insert({ org_id: org.id, user_id: user.value.id, role: 'owner' })
    if (memErr) {
      orgSetupError.value = memErr.message
      return false
    }
    const { error: profUpErr } = await sb.from('profiles').upsert({
      id: user.value.id,
      org_id: org.id,
      display_name: displayName,
    })
    if (profUpErr) {
      orgSetupError.value = profUpErr.message
      return false
    }
    orgId.value = org.id
    localStorage.setItem('pama_org_id', org.id)
    return true
  }

  async function ensureOrgSetup(): Promise<boolean> {
    if (!user.value) {
      error.value = 'Pehle login karein'
      return false
    }
    loading.value = true
    try {
      return await loadOrg()
    } finally {
      loading.value = false
    }
  }

  async function signIn(email: string, password: string) {
    error.value = ''
    const sb = getSupabase()
    if (!sb) {
      error.value = 'Pehle Settings → Cloud Sync me Supabase URL + anon key save karein (Save & Connect).'
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
      error.value = 'Pehle Settings → Cloud Sync me Supabase URL + anon key save karein (Save & Connect).'
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

  return {
    user, orgId, loading, error, orgSetupError, isConfigured, isLoggedIn, canSync, syncBlockReason,
    init, signIn, signUp, signOut, applySupabaseKeys, ensureOrgSetup,
  }
})
