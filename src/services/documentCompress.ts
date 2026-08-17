const MAX_IMAGE_DIM = 2000
const JPEG_QUALITY = 0.82
const TARGET_MAX_BYTES = 1.2 * 1024 * 1024
/** Re-render large scan PDFs as JPEG pages so cloud storage stays manageable. */
const PDF_COMPRESS_THRESHOLD_BYTES = 8 * 1024 * 1024
const STORAGE_PDF_SCALE = 1.3
const STORAGE_JPEG_QUALITY = 0.68

export interface PreparedDocumentFile {
  blob: Blob
  mime: string
  originalSize: number
  compressed: boolean
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`${file.name}: image load failed`))
    }
    img.src = url
  })
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image compression failed'))),
      'image/jpeg',
      quality,
    )
  })
}

async function compressImageFile(file: File): Promise<PreparedDocumentFile> {
  const img = await loadImageFromFile(file)
  let { width, height } = img
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height))
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(`${file.name}: canvas unavailable`)
  ctx.drawImage(img, 0, 0, width, height)

  let quality = JPEG_QUALITY
  let blob = await canvasToJpegBlob(canvas, quality)
  while (blob.size > TARGET_MAX_BYTES && quality > 0.45) {
    quality -= 0.08
    blob = await canvasToJpegBlob(canvas, quality)
  }

  return {
    blob,
    mime: 'image/jpeg',
    originalSize: file.size,
    compressed: blob.size < file.size,
  }
}

async function compressPdfForStorage(file: File): Promise<PreparedDocumentFile> {
  const { extractPdfPageImages } = await import('@/services/pdfPageImages')
  const { jsPDF } = await import('jspdf')
  const pages = await extractPdfPageImages(file, {
    scale: STORAGE_PDF_SCALE,
    jpegQuality: STORAGE_JPEG_QUALITY,
  })
  if (!pages.length) throw new Error(`${file.name}: PDF has no pages`)

  let doc: InstanceType<typeof jsPDF> | null = null
  for (const page of pages) {
    const img = `data:image/jpeg;base64,${page.base64}`
    const orient = page.width > page.height ? 'landscape' : 'portrait'
    if (!doc) {
      doc = new jsPDF({ orientation: orient, unit: 'px', format: [page.width, page.height], compress: true })
    } else {
      doc.addPage([page.width, page.height], orient)
    }
    doc.addImage(img, 'JPEG', 0, 0, page.width, page.height, undefined, 'FAST')
  }

  const blob = doc!.output('blob') as Blob
  return {
    blob,
    mime: 'application/pdf',
    originalSize: file.size,
    compressed: blob.size < file.size,
  }
}

/** Compress photos for cloud storage; large PDFs are re-rendered to a smaller file. */
export async function prepareDocumentFile(file: File): Promise<PreparedDocumentFile> {
  if (isPdf(file)) {
    if (file.size > PDF_COMPRESS_THRESHOLD_BYTES) {
      try {
        return await compressPdfForStorage(file)
      } catch {
        return { blob: file, mime: 'application/pdf', originalSize: file.size, compressed: false }
      }
    }
    return { blob: file, mime: 'application/pdf', originalSize: file.size, compressed: false }
  }
  if (isImage(file)) {
    try {
      return await compressImageFile(file)
    } catch {
      return { blob: file, mime: file.type || 'image/jpeg', originalSize: file.size, compressed: false }
    }
  }
  return {
    blob: file,
    mime: file.type || 'application/octet-stream',
    originalSize: file.size,
    compressed: false,
  }
}
