import * as pdfjs from 'pdfjs-dist'

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
}

export const MAX_PDF_PAGES = 50
const PAGE_RENDER_SCALE = 1.75
const JPEG_QUALITY = 0.82

export type PdfPageImage = {
  pageNumber: number
  base64: string
  mime: 'image/jpeg'
}

async function loadPdfDocument(file: File) {
  const data = new Uint8Array(await file.arrayBuffer())
  return pdfjs.getDocument({ data, useSystemFonts: true }).promise
}

export async function getPdfPageCount(file: File): Promise<number> {
  const pdf = await loadPdfDocument(file)
  return pdf.numPages
}

export async function extractPdfPageImages(
  file: File,
  opts?: { maxPages?: number; onPageRendered?: (pageNumber: number, totalPages: number) => void },
): Promise<PdfPageImage[]> {
  const pdf = await loadPdfDocument(file)
  const totalPages = pdf.numPages
  const maxPages = Math.min(opts?.maxPages ?? MAX_PDF_PAGES, totalPages, MAX_PDF_PAGES)

  if (totalPages > MAX_PDF_PAGES) {
    throw new Error(`${file.name}: PDF has ${totalPages} pages. Maximum supported is ${MAX_PDF_PAGES}.`)
  }

  const pages: PdfPageImage[] = []
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: PAGE_RENDER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error(`Could not render PDF page ${pageNumber}`)

    await page.render({ canvasContext: context, viewport }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    const base64 = dataUrl.split(',')[1]
    if (!base64) throw new Error(`Could not encode PDF page ${pageNumber}`)

    pages.push({ pageNumber, base64, mime: 'image/jpeg' })
    opts?.onPageRendered?.(pageNumber, totalPages)
  }

  return pages
}
