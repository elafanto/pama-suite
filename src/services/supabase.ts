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

function getBrowserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function readLocalStorage(key: string): string {
  return (getBrowserStorage()?.getItem(key) || '').trim()
}

/** Resolved URL + anon: build-time .env first, then browser localStorage (Settings). */
export function getSupabaseConfig(): { url: string; anon: string } {
  if (typeof window === 'undefined') {
    return {
      url: envUrlValid(envUrl) ? envUrl : '',
      anon: envAnonValid(envAnon) ? envAnon : '',
    }
  }
  const url = envUrlValid(envUrl) ? envUrl : readLocalStorage(LS_URL)
  const anon = envAnonValid(envAnon) ? envAnon : readLocalStorage(LS_ANON)
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
  const storage = getBrowserStorage()
  if (!storage) throw new Error('Browser storage unavailable. PWA/browser storage enable karein, phir dobara try karein.')
  storage.setItem(LS_URL, url.trim())
  storage.setItem(LS_ANON, anon.trim())
  resetSupabaseClient()
}

export function clearSupabaseKeys(): void {
  const storage = getBrowserStorage()
  storage?.removeItem(LS_URL)
  storage?.removeItem(LS_ANON)
  resetSupabaseClient()
}

export function getSupabase(): SupabaseClient | null {
  const { url, anon } = getSupabaseConfig()
  if (!url || !anon || url.includes('YOUR_PROJECT')) return null
  const key = `${url}|${anon.slice(0, 12)}`
  if (client && clientKey === key) return client
  const storage = getBrowserStorage()
  client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      ...(storage ? { storage } : {}),
    },
  })
  clientKey = key
  return client
}
