import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || ''
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabaseConfigured = !!(url && anon && !url.includes('YOUR_PROJECT'))

/** True when running on a *.vercel.app deployment (keys must be set in Vercel env + redeploy). */
export function isVercelDeploy(): boolean {
  if (typeof window === 'undefined') return false
  return /\.vercel\.app$/i.test(window.location.hostname)
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null
  if (!client) client = createClient(url, anon)
  return client
}
