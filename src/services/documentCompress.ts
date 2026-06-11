const MAX_IMAGE_DIM = 2000
const JPEG_QUALITY = 0.82
const TARGET_MAX_BYTES = 1.2 * 1024 * 1024

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

/** Compress photos for cloud storage; PDFs pass through unchanged. */
export async function prepareDocumentFile(file: File): Promise<PreparedDocumentFile> {
  if (isPdf(file)) {
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
