// Generate pwa-192.png and pwa-512.png for the PWA manifest
import { createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dir, '../public')

function drawIcon(size) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  const r = size * 0.14  // corner radius

  // Background — navy gradient
  const bg = ctx.createLinearGradient(0, 0, size, size)
  bg.addColorStop(0, '#0f2444')
  bg.addColorStop(1, '#1a3c6e')

  // Rounded rect background
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(size - r, 0)
  ctx.quadraticCurveTo(size, 0, size, r)
  ctx.lineTo(size, size - r)
  ctx.quadraticCurveTo(size, size, size - r, size)
  ctx.lineTo(r, size)
  ctx.quadraticCurveTo(0, size, 0, size - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fillStyle = bg
  ctx.fill()

  // "P" lettermark — bold white
  const fontSize = Math.round(size * 0.55)
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('P', size / 2, size * 0.5)

  // Accent dot — accent blue
  const dotR = size * 0.07
  ctx.beginPath()
  ctx.arc(size * 0.66, size * 0.68, dotR, 0, Math.PI * 2)
  ctx.fillStyle = '#2563eb'
  ctx.fill()

  return c.toBuffer('image/png')
}

for (const size of [192, 512]) {
  const buf = drawIcon(size)
  const file = `${OUT}/pwa-${size}.png`
  writeFileSync(file, buf)
  console.log(`✓ ${file} (${buf.length} bytes)`)
}
console.log('Icons generated!')
