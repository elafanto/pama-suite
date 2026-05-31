import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const LS_URL = 'pama_supabase_url'
const LS_ANON = 'pama_supabase_anon_key'

const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const envAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

function envUrlValid(url: string): boolean {
  return !!url && !url.includes('YOUR_PROJECT')
}

function envAnonValid(anon: string): boolean {
  return !!anon && anon !== 'your_anon_key_here'
}

/** Resolved URL + anon: build-time .env first, then browser localStorage (Settings). */
export function getSupabaseConfig(): { url: string; anon: string } {
  if (typeof window === 'undefined') {
    return {
      url: envUrlValid(envUrl) ? envUrl : '',
      anon: envAnonValid(envAnon) ? envAnon : '',
    }
  }
  const url = envUrlValid(envUrl) ? envUrl : (localStorage.getItem(LS_URL) || '').trim()
  const anon = envAnonValid(envAnon) ? envAnon : (localStorage.getItem(LS_ANON) || '').trim()
  return { url, anon }
}

export function isSupabaseConfigured(): boolean {
  const { url, anon } = getSupabaseConfig()
  return !!(url && anon && !url.includes('YOUR_PROJECT'))
}

/** @deprecated use isSupabaseConfigured() — kept for existing imports */
export const supabaseConfigured = isSupabaseConfigured()

/** True when not localhost (Vercel, custom domain, LAN IP, etc.). */
export function isHostedDeploy(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '[::1]'
}

/** @deprecated use isHostedDeploy() */
export function isVercelDeploy(): boolean {
  return isHostedDeploy()
}

let client: SupabaseClient | null = null
let clientKey = ''

export function resetSupabaseClient(): void {
  client = null
  clientKey = ''
}

export function saveSupabaseKeys(url: string, anon: string): void {
  localStorage.setItem(LS_URL, url.trim())
  localStorage.setItem(LS_ANON, anon.trim())
  resetSupabaseClient()
}

export function clearSupabaseKeys(): void {
  localStorage.removeItem(LS_URL)
  localStorage.removeItem(LS_ANON)
  resetSupabaseClient()
}

export function getSupabase(): SupabaseClient | null {
  const { url, anon } = getSupabaseConfig()
  if (!url || !anon || url.includes('YOUR_PROJECT')) return null
  const key = `${url}|${anon.slice(0, 12)}`
  if (client && clientKey === key) return client
  client = createClient(url, anon)
  clientKey = key
  return client
}
