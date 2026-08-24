/** Gemini invoice / voucher scanner (ported from PamaTools billing). */

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_TIMEOUT_MS = 45_000
/** Multi-page purchase PDFs need more time than a single invoice photo. */
const GEMINI_MULTI_BILL_TIMEOUT_MS = 120_000
const GEMINI_LARGE_PDF_TIMEOUT_MS = 180_000
const GEMINI_PAGE_SCAN_TIMEOUT_MS = 60_000
const LARGE_PDF_BYTES = 2 * 1024 * 1024
/** Whole-PDF scan is unreliable above this size — use page-by-page instead. */
export const PAGE_BY_PAGE_PDF_BYTES = 4 * 1024 * 1024
export const PAGE_BY_PAGE_MIN_PAGES = 4
const GEMINI_MAX_ATTEMPTS = 3
const GEMINI_MULTI_BILL_MAX_ATTEMPTS = 2
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
  supplierName?: string | number
  billNo?: string | number
  date?: string
  items?: ScanLineItem[]
  sub?: number
  totalTax?: number
  grandTotal?: number
  gstin?: string | number
  address?: string
  city?: string
  pin?: string | number
  phone?: string | number
  bank?: string
  acno?: string | number
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

function isTimeoutError(err: unknown) {
  return err instanceof Error && /timed out/i.test(err.message)
}

/** How long to wait for Gemini (multi-bill PDF/image scans). */
export function resolveMultiBillScanTimeoutMs(fileSizeBytes?: number, mimeType?: string): number {
  if (mimeType === 'application/pdf') {
    if (fileSizeBytes && fileSizeBytes >= PAGE_BY_PAGE_PDF_BYTES) return GEMINI_LARGE_PDF_TIMEOUT_MS
    if (fileSizeBytes && fileSizeBytes >= LARGE_PDF_BYTES) return GEMINI_LARGE_PDF_TIMEOUT_MS
    return GEMINI_MULTI_BILL_TIMEOUT_MS
  }
  return GEMINI_MULTI_BILL_TIMEOUT_MS
}

export function shouldUsePageByPagePdfScan(fileSizeBytes: number, pageCount: number): boolean {
  return pageCount >= PAGE_BY_PAGE_MIN_PAGES || fileSizeBytes >= PAGE_BY_PAGE_PDF_BYTES
}

export function formatMultiBillScanWaitHint(
  fileSizeBytes?: number,
  mimeType?: string,
  pageCount?: number,
): string {
  if (mimeType === 'application/pdf' && pageCount && shouldUsePageByPagePdfScan(fileSizeBytes || 0, pageCount)) {
    const secPerPage = Math.round(GEMINI_PAGE_SCAN_TIMEOUT_MS / 1000)
    const estMin = Math.max(1, Math.ceil((pageCount * secPerPage) / 60))
    return `${pageCount}-page PDF — scanning page-by-page (~${estMin} min). Keep this tab open.`
  }
  const sec = Math.round(resolveMultiBillScanTimeoutMs(fileSizeBytes, mimeType) / 1000)
  if (mimeType === 'application/pdf' && fileSizeBytes && fileSizeBytes >= LARGE_PDF_BYTES) {
    return `Large PDF — up to ${sec}s per attempt. Keep this tab open.`
  }
  if (mimeType === 'application/pdf') {
    return `PDF scan — up to ${sec}s. Multi-page bills take longer.`
  }
  return `Scanning — up to ${sec}s.`
}

export type ScanProgressCallback = (info: {
  phase: 'render' | 'scan'
  current: number
  total: number
  message: string
}) => void

function isMeaningfulBill(bill: ScanResult) {
  return Boolean(normScanText(bill.supplierName) || normScanText(bill.billNo) || bill.items?.length)
}

function normScanText(value?: string | number | null) {
  return String(value ?? '').trim().toLowerCase()
}

function normScanBillNo(value?: string | number | null) {
  return normScanText(value).replace(/[\s\-_/]+/g, '')
}

function scanSuppliersMatch(a: ScanResult, b: ScanResult) {
  const nameA = normScanText(a.supplierName)
  const nameB = normScanText(b.supplierName)
  if (nameA && nameB && nameA === nameB) return true
  const gstA = normScanText(a.gstin)
  const gstB = normScanText(b.gstin)
  return Boolean(gstA && gstB && gstA === gstB)
}

function scanBillNosMatch(a: ScanResult, b: ScanResult) {
  const noA = normScanBillNo(a.billNo)
  const noB = normScanBillNo(b.billNo)
  return Boolean(noA && noB && noA === noB)
}

function isContinuationScanPage(bill: ScanResult) {
  const hasItems = Boolean(bill.items?.length)
  const missingHeader = !normScanText(bill.supplierName) && !normScanText(bill.billNo)
  return hasItems && missingHeader
}

function shouldMergeScanBills(primary: ScanResult, continuation: ScanResult) {
  if (isContinuationScanPage(continuation) && (normScanText(primary.supplierName) || normScanText(primary.billNo))) return true
  if (scanBillNosMatch(primary, continuation) && scanSuppliersMatch(primary, continuation)) return true
  if (scanBillNosMatch(primary, continuation) && isContinuationScanPage(continuation)) return true
  if (scanSuppliersMatch(primary, continuation) && isContinuationScanPage(continuation)) return true
  if (scanBillNosMatch(primary, continuation) && !normScanText(continuation.supplierName)) return true
  return false
}

function mergeTwoScanBills(primary: ScanResult, continuation: ScanResult): ScanResult {
  return {
    supplierName: primary.supplierName || continuation.supplierName,
    billNo: primary.billNo || continuation.billNo,
    date: primary.date || continuation.date,
    gstin: primary.gstin || continuation.gstin,
    address: primary.address || continuation.address,
    city: primary.city || continuation.city,
    pin: primary.pin || continuation.pin,
    phone: primary.phone || continuation.phone,
    bank: primary.bank || continuation.bank,
    acno: primary.acno || continuation.acno,
    ifsc: primary.ifsc || continuation.ifsc,
    acname: primary.acname || continuation.acname,
    items: [...(primary.items || []), ...(continuation.items || [])],
    sub: continuation.sub || primary.sub,
    totalTax: continuation.totalTax || primary.totalTax,
    grandTotal: continuation.grandTotal || primary.grandTotal,
  }
}

/** Merge consecutive pages that belong to the same supplier bill. */
export function mergeContinuationBills(bills: ScanResult[]): ScanResult[] {
  if (bills.length <= 1) return bills.map((bill) => ({ ...bill, items: [...(bill.items || [])] }))

  const merged: ScanResult[] = []
  for (const bill of bills) {
    const previous = merged[merged.length - 1]
    if (previous && shouldMergeScanBills(previous, bill)) {
      merged[merged.length - 1] = mergeTwoScanBills(previous, bill)
      continue
    }
    merged.push({ ...bill, items: [...(bill.items || [])] })
  }
  return merged
}

function finalizePurchaseBillScan(bills: ScanResult[]): PurchaseBillsScanResult {
  return { bills: mergeContinuationBills(bills) }
}

type GenerateJsonOptions = {
  timeoutMs?: number
  maxAttempts?: number
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

async function generateJson<T>(
  apiKey: string,
  prompt: string,
  base64: string,
  mimeType: string,
  label: string,
  options: GenerateJsonOptions = {},
): Promise<T> {
  if (!apiKey) throw new Error('Gemini API key missing — Settings me save karo')

  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? GEMINI_MAX_ATTEMPTS
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
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs)

      if (!res.ok) {
        const err = await res.text()
        const message = `Gemini ${GEMINI_MODEL} error while scanning ${label}: ${res.status} ${err.slice(0, 240)}`
        if (attempt < maxAttempts && isRetryableStatus(res.status)) {
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
      if (attempt < maxAttempts && isRetryableError(err)) {
        await sleep(500 * attempt)
        continue
      }
      throw err instanceof Error && err.name === 'AbortError'
        ? new Error(`Gemini ${GEMINI_MODEL} timed out while scanning ${label} (waited ${Math.round(timeoutMs / 1000)}s)`)
        : err
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`Gemini ${GEMINI_MODEL} failed while scanning ${label}`)
}

export async function scanInvoiceImage(
  apiKey: string,
  base64: string,
  mimeType: string,
  opts?: { timeoutMs?: number; pdfPage?: boolean },
): Promise<ScanResult> {
  const pageHint = opts?.pdfPage
    ? 'This image may be one page of a multi-page invoice. If it is a continuation page (items/tax/totals only, no new bill header), keep the same billNo and supplierName as the first page when visible; do not invent a new bill.'
    : ''
  const prompt = `You are an invoice OCR assistant for Indian GST bills. Extract JSON only (no markdown):
${pageHint}
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
  return generateJson<ScanResult>(apiKey, prompt, base64, mimeType, 'purchase invoice', {
    timeoutMs: opts?.timeoutMs,
  })
}

export async function scanPurchaseBillsPdf(
  apiKey: string,
  base64: string,
  mimeType: string,
  opts?: { fileSizeBytes?: number; pageCount?: number },
): Promise<PurchaseBillsScanResult> {
  const timeoutMs = resolveMultiBillScanTimeoutMs(opts?.fileSizeBytes, mimeType)
  const prompt = `You are an OCR assistant for Indian purchase invoice documents.
The uploaded file may be a PDF or image with one or many supplier bills/invoices.
IMPORTANT: One supplier + one bill number = ONE bill even if it spans multiple pages. Merge all pages of the same bill into a single bills[] entry.
Only create separate bills when supplier or bill number clearly changes.
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
  try {
    const result = await generateJson<PurchaseBillsScanResult>(
      apiKey,
      prompt,
      base64,
      mimeType,
      'multi purchase bill document',
      { timeoutMs, maxAttempts: GEMINI_MULTI_BILL_MAX_ATTEMPTS },
    )
    const bills = Array.isArray(result?.bills) ? result.bills : []
    if (bills.length) return finalizePurchaseBillScan(bills)
  } catch (err) {
    if (!isTimeoutError(err)) throw err
    // Fallback: treat whole document as one invoice (faster prompt path).
    try {
      const single = await scanInvoiceImage(apiKey, base64, mimeType, { timeoutMs })
      if (single.supplierName || single.billNo || single.items?.length) {
        return finalizePurchaseBillScan([single])
      }
    } catch {
      /* keep original timeout error */
    }
    throw new Error(
      `${err instanceof Error ? err.message : 'Scan timed out'}. `
      + 'Try a smaller PDF, fewer pages, or scan one bill at a time from the New Bill tab.',
    )
  }
  return finalizePurchaseBillScan([])
}

export async function scanPurchaseBillsFromFile(
  apiKey: string,
  file: File,
  opts?: { onProgress?: ScanProgressCallback },
): Promise<PurchaseBillsScanResult> {
  const { mime, isPdf } = validateScanFile(file, { allowImages: true, allowPdf: true })

  if (!isPdf) {
    const { base64 } = await fileToBase64(file, { allowImages: true, allowPdf: true })
    return scanPurchaseBillsPdf(apiKey, base64, mime, { fileSizeBytes: file.size })
  }

  const { getPdfPageCount, extractPdfPageImages } = await import('@/services/pdfPageImages')
  const pageCount = await getPdfPageCount(file)

  if (!shouldUsePageByPagePdfScan(file.size, pageCount)) {
    const { base64 } = await fileToBase64(file, { allowImages: true, allowPdf: true })
    return scanPurchaseBillsPdf(apiKey, base64, mime, { fileSizeBytes: file.size, pageCount })
  }

  opts?.onProgress?.({
    phase: 'render',
    current: 0,
    total: pageCount,
    message: `Preparing ${pageCount}-page PDF...`,
  })

  const pages = await extractPdfPageImages(file, {
    onPageRendered: (current, total) => {
      opts?.onProgress?.({
        phase: 'render',
        current,
        total,
        message: `Rendering page ${current}/${total}...`,
      })
    },
  })

  const bills: ScanResult[] = []
  let failedPages = 0

  for (const page of pages) {
    opts?.onProgress?.({
      phase: 'scan',
      current: page.pageNumber,
      total: pages.length,
      message: `Scanning page ${page.pageNumber}/${pages.length} with Gemini...`,
    })

    try {
      const bill = await scanInvoiceImage(apiKey, page.base64, page.mime, {
        timeoutMs: GEMINI_PAGE_SCAN_TIMEOUT_MS,
        pdfPage: true,
      })
      if (isMeaningfulBill(bill)) bills.push(bill)
    } catch {
      failedPages += 1
    }
  }

  if (!bills.length && failedPages === pages.length) {
    throw new Error(
      `${file.name}: All ${pages.length} page scans failed. Check Gemini API key and network, then retry.`,
    )
  }

  if (failedPages) {
    opts?.onProgress?.({
      phase: 'scan',
      current: pages.length,
      total: pages.length,
      message: `${bills.length} bill(s) from ${pages.length - failedPages}/${pages.length} pages.`,
    })
  }

  return finalizePurchaseBillScan(bills)
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
