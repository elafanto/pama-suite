/** Gemini invoice / voucher scanner (ported from PamaTools billing). */

export interface ScanResult {
  supplierName?: string
  billNo?: string
  date?: string
  items?: { name: string; qty: number; rate: number; hsn?: string; gst?: number }[]
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

export async function scanInvoiceImage(
  apiKey: string,
  base64: string,
  mimeType: string
): Promise<ScanResult> {
  if (!apiKey) throw new Error('Gemini API key missing — Settings me save karo')

  const prompt = `You are an invoice OCR assistant for Indian GST bills. Extract JSON only (no markdown):
{
  "supplierName": "", "billNo": "", "date": "YYYY-MM-DD", "gstin": "",
  "address": "", "city": "", "pin": "", "phone": "",
  "bank": "", "acno": "", "ifsc": "", "acname": "",
  "items": [{"name":"","qty":0,"rate":0,"hsn":"","gst":18}],
  "sub": 0, "totalTax": 0, "grandTotal": 0
}`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`

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
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini error: ${res.status} ${err.slice(0, 200)}`)
  }

  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse scan result')
  return JSON.parse(match[0]) as ScanResult
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
  if (!apiKey) throw new Error('Gemini API key missing — Settings me save karo')

  const prompt = `You are a voucher OCR assistant for Indian accounting (Payment Voucher PV, Receipt RV, Journal JV). Extract JSON only:
{
  "date": "YYYY-MM-DD", "voucherNo": "", "type": "PV",
  "narration": "", "payeeName": "", "amount": 0,
  "debitAccount": "", "creditAccount": ""
}`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`

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
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini error: ${res.status} ${err.slice(0, 200)}`)
  }

  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse voucher scan')
  return JSON.parse(match[0]) as VoucherScanResult
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
