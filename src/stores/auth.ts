import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getSupabase,
  isSupabaseConfigured,
  isHostedDeploy,
  saveSupabaseKeys,
} from '@/services/supabase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<{ id: string; email: string } | null>(null)
  const orgId = ref<string | null>(localStorage.getItem('pama_org_id'))
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref('')
  const orgSetupError = ref('')
  const statusMessage = ref('')
  /** Bump after manual key save so computed isConfigured refreshes. */
  const configVersion = ref(0)
  let authSubscription: { unsubscribe: () => void } | null = null

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
    try {
      saveSupabaseKeys(url, anon)
      user.value = null
      orgId.value = null
      localStorage.removeItem('pama_org_id')
      configVersion.value++
      initialized.value = false
      await init()
      return isSupabaseConfigured()
    } catch (err: any) {
      error.value = err?.message || 'Supabase keys save nahi ho paaye'
      return false
    }
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
        return `Organization setup failed:\n\n${orgSetupError.value}\n\nFix: Supabase → SQL Editor → run migrations 003 through 007 in order\n\nPhir Settings me "Setup Organization" dabayein.`
      }
      return 'Organization not ready yet.\n\nSettings → Cloud Sync → "Setup Organization" dabayein.\n\nAgar error aaye to Supabase SQL migrations 003 through 007 run karein (see SETUP.md).'
    }
    return null
  })

  async function init() {
    const sb = getSupabase()
    if (!sb) {
      initialized.value = true
      statusMessage.value = 'Supabase not configured'
      return
    }
    loading.value = true
    statusMessage.value = 'Checking saved login...'
    authSubscription?.unsubscribe()
    authSubscription = null
    try {
      const sessionResult = await Promise.race([
        sb.auth.getSession(),
        new Promise<Awaited<ReturnType<typeof sb.auth.getSession>>>((resolve) =>
          setTimeout(() => resolve({ data: { session: null }, error: null } as Awaited<ReturnType<typeof sb.auth.getSession>>), 8000),
        ),
      ])
      const { data, error: sessionErr } = sessionResult
      if (sessionErr) {
        error.value = sessionErr.message
        statusMessage.value = 'Saved login check failed'
      }
      if (data?.session?.user) {
        user.value = { id: data.session.user.id, email: data.session.user.email || '' }
        statusMessage.value = `Signed in as ${user.value.email}`
        await loadOrg()
      } else {
        user.value = null
        statusMessage.value = 'Not signed in'
      }
      const { data: listener } = sb.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          user.value = { id: session.user.id, email: session.user.email || '' }
          statusMessage.value = `Signed in as ${user.value.email}`
          loadOrg()
        } else {
          user.value = null
          statusMessage.value = 'Not signed in'
          if (event === 'SIGNED_OUT') {
            orgId.value = null
            localStorage.removeItem('pama_org_id')
          }
        }
      })
      authSubscription = listener.subscription
    } catch (err: any) {
      error.value = err?.message || 'Auth init failed'
      statusMessage.value = 'Could not check saved login'
    } finally {
      initialized.value = true
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

    orgSetupError.value = bootErr?.message || 'Could not create organization. Run the latest Supabase migrations and try again.'
    return false
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
    statusMessage.value = ''
    const sb = getSupabase()
    if (!sb) {
      error.value = 'Pehle Settings → Cloud Sync me Supabase URL + anon key save karein (Save & Connect).'
      return false
    }
    loading.value = true
    statusMessage.value = 'Signing in...'
    try {
      const { data: sessionData, error: err } = await sb.auth.signInWithPassword({ email, password })
      if (err) { error.value = err.message; statusMessage.value = 'Sign in failed'; return false }
      if (sessionData.session?.user) {
        user.value = { id: sessionData.session.user.id, email: sessionData.session.user.email || '' }
        statusMessage.value = `Signed in as ${user.value.email}`
        await loadOrg()
        return true
      }
      error.value = 'Sign in complete nahi hua. Email/password check karein ya email confirmation pending ho sakti hai.'
      statusMessage.value = 'Sign in incomplete'
      return false
    } finally {
      loading.value = false
    }
  }

  async function signUp(email: string, password: string) {
    error.value = ''
    statusMessage.value = ''
    const sb = getSupabase()
    if (!sb) {
      error.value = 'Pehle Settings → Cloud Sync me Supabase URL + anon key save karein (Save & Connect).'
      return false
    }
    loading.value = true
    statusMessage.value = 'Creating account...'
    try {
      const { error: err } = await sb.auth.signUp({ email, password })
      if (err) { error.value = err.message; statusMessage.value = 'Sign up failed'; return false }
      statusMessage.value = 'Account created. Email confirm karke sign in karein.'
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
    statusMessage.value = 'Signed out'
    localStorage.removeItem('pama_org_id')
  }

  return {
    user, orgId, loading, initialized, error, orgSetupError, statusMessage, isConfigured, isLoggedIn, canSync, syncBlockReason,
    init, signIn, signUp, signOut, applySupabaseKeys, ensureOrgSetup,
  }
})
