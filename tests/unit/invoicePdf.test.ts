import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { wrapPdfText } from '@/services/invoicePdf'

describe('wrapPdfText', () => {
  it('wraps a long party name to multiple lines', () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    pdf.setFont('helvetica', 'bold').setFontSize(9)
    const lines = wrapPdfText(
      pdf,
      'M/s Super Long Packaging Industries Private Limited And Allied Trading Company',
      58,
    )
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toContain('Packaging Industries')
  })

  it('keeps address line breaks and wraps long lines', () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    const lines = wrapPdfText(
      pdf,
      'Plot No. 12, Industrial Area Phase 2 Near Very Long Landmark Name\nSecond Line, City',
      58,
    )
    expect(lines.length).toBeGreaterThan(2)
    expect(lines.some((line) => line.includes('Second Line'))).toBe(true)
  })

  it('returns empty for blank text', () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    expect(wrapPdfText(pdf, '   ', 58)).toEqual([])
  })
})
