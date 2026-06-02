/** Gemini invoice / voucher scanner (ported from PamaTools billing). */

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

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

async function generateJson<T>(apiKey: string, prompt: string, base64: string, mimeType: string, label: string): Promise<T> {
  if (!apiKey) throw new Error('Gemini API key missing — Settings me save karo')

  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
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
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini ${GEMINI_MODEL} error while scanning ${label}: ${res.status} ${err.slice(0, 240)}`)
  }

  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('\n') || ''
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) throw new Error(`Could not parse ${label} scan result`)
  return JSON.parse(match[0]) as T
}

export async function scanInvoiceImage(
  apiKey: string,
  base64: string,
  mimeType: string
): Promise<ScanResult> {
  const prompt = `You are an invoice OCR assistant for Indian GST bills. Extract JSON only (no markdown):
For kraft paper reel stock lines, extract reel metadata when visible. Use color "NS" for Natural Shade/Natural Brown/Neutral Brown and "GY" for Golden Yellow. Deckle/reel size can go in deckleSize and reelSize.
{
  "supplierName": "", "billNo": "", "date": "YYYY-MM-DD", "gstin": "",
  "address": "", "city": "", "pin": "", "phone": "",
  "bank": "", "acno": "", "ifsc": "", "acname": "",
  "items": [{
    "name":"","qty":0,"unit":"KG","rate":0,"hsn":"","gst":18,
    "isConsumable": false,
    "consumableType": "glue|ink|stitching_wire",
    "isKraftReel": false,
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
  const prompt = `You are an OCR assistant for Indian purchase invoice PDFs.
The uploaded PDF may contain one or many supplier bills/invoices, often one invoice per page.
Extract all purchase bills as JSON only, no markdown. If uncertain, still return the best structured data and leave missing fields blank.
Classify glue, ink and stitching wire line items as consumables.
Classify kraft paper reel line items as kraft reels only when reel/deckle/gsm/bf details are visible.
For kraft paper reel lines, extract GSM, BF, color, deckle/reel size and reel weight. Use color "NS" for Natural Shade/Natural Brown/Neutral Brown and "GY" for Golden Yellow. If reel count or reel number is present, include it, but leave blank/0 when absent.
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
  const result = await generateJson<PurchaseBillsScanResult>(apiKey, prompt, base64, mimeType, 'multi purchase PDF')
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

export function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      resolve({ base64, mime: file.type || 'image/jpeg' })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
