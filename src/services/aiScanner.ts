/** Gemini invoice / voucher scanner (ported from PamaTools billing). */

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_TIMEOUT_MS = 45_000
const GEMINI_MAX_ATTEMPTS = 3
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PDF_BYTES = 20 * 1024 * 1024

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const SUPPORTED_PDF_MIME_TYPES = new Set(['application/pdf'])

export type ConsumableScanType = 'glue' | 'ink' | 'stitching_wire'

export interface ScanLineItem {
  name: string
  qty: number
  unit?: string
  rate: number
  hsn?: string
  gst?: number
  isConsumable?: boolean
  consumableType?: ConsumableScanType
  isKraftReel?: boolean
  paperType?: 'KRAFT' | 'DUPLEX' | string
  reelNo?: string
  deckleSize?: string
  reelSize?: string
  gsm?: string
  bf?: string
  color?: 'NS' | 'GY' | 'NATURAL_BROWN' | string
  reelWeight?: number
  reelCount?: number
}

export interface ScanResult {
  supplierName?: string
  billNo?: string
  date?: string
  items?: ScanLineItem[]
  sub?: number
  totalTax?: number
  grandTotal?: number
  gstin?: string
  address?: string
  city?: string
  pin?: string
  phone?: string
  bank?: string
  acno?: string
  ifsc?: string
  acname?: string
}

export interface PurchaseBillsScanResult {
  bills: ScanResult[]
}

type ScanFileOptions = {
  allowImages?: boolean
  allowPdf?: boolean
}

const DEFAULT_SCAN_FILE_OPTIONS: Required<ScanFileOptions> = {
  allowImages: true,
  allowPdf: true,
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${bytes} B`
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

function isRetryableError(err: unknown) {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TypeError')
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

function extractJsonPayload(text: string, label: string) {
  const trimmed = text.trim()
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const direct = tryParseJson(unfenced)
  if (direct.ok) return direct.value

  for (const opener of ['{', '['] as const) {
    const start = unfenced.indexOf(opener)
    if (start === -1) continue

    const closer = opener === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false

    for (let idx = start; idx < unfenced.length; idx += 1) {
      const char = unfenced[idx]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
      } else if (char === opener) {
        depth += 1
      } else if (char === closer) {
        depth -= 1
        if (depth === 0) {
          const parsed = tryParseJson(unfenced.slice(start, idx + 1))
          if (parsed.ok) return parsed.value
          break
        }
      }
    }
  }

  throw new Error(`Could not parse ${label} scan result as JSON`)
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

async function generateJson<T>(apiKey: string, prompt: string, base64: string, mimeType: string, label: string): Promise<T> {
  if (!apiKey) throw new Error('Gemini API key missing — Settings me save karo')

  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: { response_mime_type: 'application/json' },
    }),
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, init, GEMINI_TIMEOUT_MS)

      if (!res.ok) {
        const err = await res.text()
        const message = `Gemini ${GEMINI_MODEL} error while scanning ${label}: ${res.status} ${err.slice(0, 240)}`
        if (attempt < GEMINI_MAX_ATTEMPTS && isRetryableStatus(res.status)) {
          lastError = new Error(message)
          await sleep(500 * attempt)
          continue
        }
        throw new Error(message)
      }

      const json = await res.json()
      const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('\n') || ''
      return extractJsonPayload(text, label) as T
    } catch (err) {
      lastError = err
      if (attempt < GEMINI_MAX_ATTEMPTS && isRetryableError(err)) {
        await sleep(500 * attempt)
        continue
      }
      throw err instanceof Error && err.name === 'AbortError'
        ? new Error(`Gemini ${GEMINI_MODEL} timed out while scanning ${label}`)
        : err
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`Gemini ${GEMINI_MODEL} failed while scanning ${label}`)
}

export async function scanInvoiceImage(
  apiKey: string,
  base64: string,
  mimeType: string
): Promise<ScanResult> {
  const prompt = `You are an invoice OCR assistant for Indian GST bills. Extract JSON only (no markdown):
For paper reel stock lines, extract reel metadata when visible. Use paperType "KRAFT" for kraft paper and "DUPLEX" for duplex paper. Use color "NS" for Natural Shade/Natural Brown/Neutral Brown and "GY" for Golden Yellow. Deckle/reel size can go in deckleSize and reelSize.
{
  "supplierName": "", "billNo": "", "date": "YYYY-MM-DD", "gstin": "",
  "address": "", "city": "", "pin": "", "phone": "",
  "bank": "", "acno": "", "ifsc": "", "acname": "",
  "items": [{
    "name":"","qty":0,"unit":"KG","rate":0,"hsn":"","gst":18,
    "isConsumable": false,
    "consumableType": "glue|ink|stitching_wire",
    "isKraftReel": false,
    "paperType": "KRAFT|DUPLEX",
    "reelNo": "",
    "deckleSize": "",
    "reelSize": "",
    "gsm": "",
    "bf": "",
    "color": "NS|GY",
    "reelWeight": 0,
    "reelCount": 0
  }],
  "sub": 0, "totalTax": 0, "grandTotal": 0
}`
  return generateJson<ScanResult>(apiKey, prompt, base64, mimeType, 'purchase invoice')
}

export async function scanPurchaseBillsPdf(
  apiKey: string,
  base64: string,
  mimeType: string,
): Promise<PurchaseBillsScanResult> {
  const prompt = `You are an OCR assistant for Indian purchase invoice documents.
The uploaded file may be a PDF or image and may contain one or many supplier bills/invoices, often one invoice per page.
Extract all purchase bills as JSON only, no markdown. If uncertain, still return the best structured data and leave missing fields blank.
Classify glue, ink and stitching wire line items as consumables.
Classify paper reel line items as reels when reel/deckle/gsm/bf details are visible.
For paper reel lines, extract paperType ("KRAFT" for kraft paper, "DUPLEX" for duplex paper), GSM, BF, color, deckle/reel size and reel weight. Use color "NS" for Natural Shade/Natural Brown/Neutral Brown and "GY" for Golden Yellow. If reel count or reel number is present, include it, but leave blank/0 when absent.
{
  "bills": [
    {
      "supplierName": "",
      "billNo": "",
      "date": "YYYY-MM-DD",
      "gstin": "",
      "address": "",
      "city": "",
      "pin": "",
      "phone": "",
      "items": [
        {
          "name": "",
          "qty": 0,
          "unit": "KG",
          "rate": 0,
          "hsn": "",
          "gst": 18,
          "isConsumable": false,
          "consumableType": "glue|ink|stitching_wire",
          "isKraftReel": false,
          "paperType": "KRAFT|DUPLEX",
          "reelNo": "",
          "deckleSize": "",
          "reelSize": "",
          "gsm": "",
          "bf": "",
          "color": "NS|GY",
          "reelWeight": 0,
          "reelCount": 0
        }
      ],
      "sub": 0,
      "totalTax": 0,
      "grandTotal": 0
    }
  ]
}`
  const result = await generateJson<PurchaseBillsScanResult>(apiKey, prompt, base64, mimeType, 'multi purchase bill document')
  return { bills: Array.isArray(result?.bills) ? result.bills : [] }
}

export interface VoucherScanResult {
  date?: string
  voucherNo?: string
  type?: 'PV' | 'RV' | 'JV' | 'CV'
  narration?: string
  payeeName?: string
  amount?: number
  debitAccount?: string
  creditAccount?: string
}

export async function scanVoucherImage(
  apiKey: string,
  base64: string,
  mimeType: string,
): Promise<VoucherScanResult> {
  const prompt = `You are a voucher OCR assistant for Indian accounting (Payment Voucher PV, Receipt RV, Journal JV). Extract JSON only:
{
  "date": "YYYY-MM-DD", "voucherNo": "", "type": "PV",
  "narration": "", "payeeName": "", "amount": 0,
  "debitAccount": "", "creditAccount": ""
}`
  return generateJson<VoucherScanResult>(apiKey, prompt, base64, mimeType, 'voucher')
}

function inferMimeType(file: File): string {
  if (file.type) return file.type
  const ext = file.name.toLowerCase().split('.').pop()
  const byExtension: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }
  return byExtension[ext || ''] || ''
}

export function validateScanFile(file: File, options: ScanFileOptions = {}) {
  const { allowImages, allowPdf } = { ...DEFAULT_SCAN_FILE_OPTIONS, ...options }
  const mime = inferMimeType(file)
  const isImage = SUPPORTED_IMAGE_MIME_TYPES.has(mime)
  const isPdf = SUPPORTED_PDF_MIME_TYPES.has(mime)

  if ((!allowImages || !isImage) && (!allowPdf || !isPdf)) {
    const allowed = [
      allowImages ? 'JPG, PNG or WebP image' : '',
      allowPdf ? 'PDF' : '',
    ].filter(Boolean).join(' or ')
    throw new Error(`${file.name}: unsupported file type. Upload ${allowed}.`)
  }

  const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
  if (file.size > maxBytes) {
    throw new Error(`${file.name}: file is ${formatBytes(file.size)}. Maximum allowed is ${formatBytes(maxBytes)}.`)
  }

  return { mime, isImage, isPdf }
}

export function fileToBase64(file: File, options?: ScanFileOptions): Promise<{ base64: string; mime: string }> {
  const { mime } = validateScanFile(file, options)

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      if (!base64) {
        reject(new Error(`${file.name}: could not read file contents`))
        return
      }
      resolve({ base64, mime })
    }
    reader.onerror = () => reject(new Error(`${file.name}: could not read file contents`))
    reader.readAsDataURL(file)
  })
}
