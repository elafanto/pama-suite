import * as XLSX from 'xlsx'
import { ADHESIVE_DEFAULTS, AUTO_DOUBLE_PIN_THRESHOLD_GM, MACHINE_LIMITS } from '@/services/calculator'
import { mergeBoxSheetSettings, type BoxSheetSettings } from '@/services/boxSheetSettings'
import type { BoxCalcForm } from '@/services/boxcalcUi'

type CalcResult = Record<string, any>

const MM_PER_INCH = 25.4

function n(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeFilename(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'Box'
}

function formulaCell(formula: string, value?: number | string): XLSX.CellObject {
  return {
    t: typeof value === 'string' ? 's' : 'n',
    f: formula,
    ...(value !== undefined ? { v: value } : {}),
  } as XLSX.CellObject
}

function setFormula(
  sheet: XLSX.WorkSheet,
  address: string,
  formula: string,
  value?: number | string,
  format?: string,
) {
  sheet[address] = formulaCell(formula, value)
  if (format) sheet[address].z = format
}

function setFormat(sheet: XLSX.WorkSheet, addresses: string[], format: string) {
  for (const address of addresses) {
    if (sheet[address]) sheet[address].z = format
  }
}

/**
 * Formula-driven RSC workbook. Yellow/input formatting is intentionally avoided
 * because the community xlsx writer does not preserve cell styles reliably.
 * Values in column B under INPUTS are editable; formula rows recalculate in Excel.
 */
export function buildBoxCalcWorkbook(
  form: BoxCalcForm,
  results: CalcResult,
  settings?: BoxSheetSettings | null,
): XLSX.WorkBook {
  if (form.calcMode !== 'box') throw new Error('Excel export is available for Box (RSC) calculation.')

  const cfg = mergeBoxSheetSettings(settings)
  const factor = form.dimensionUnit === 'inch' ? MM_PER_INCH : 1
  const lengthMm = n(form.length) * factor
  const widthMm = n(form.width) * factor
  const heightMm = n(form.height) * factor
  const heightAllowance = cfg.heightAllowanceDefaults[form.ply] ?? 0
  const glueFlap = n(form.glueFlap, cfg.glueFlapDefaults[form.ply] || 40)
  const pinMode = form.joining.pinHeadType
    ? form.joining.pinHeadType[0].toUpperCase() + form.joining.pinHeadType.slice(1)
    : 'Auto'

  const rows: (string | number)[][] = [
    ['PAMA SUITE — BOX CALCULATION (FORMULA SHEET)'],
    ['Edit values in the INPUTS section. Formula cells recalculate when opened in Excel.'],
    [],
    ['CUSTOMER / BOX'],
    ['Customer', form.customerName],
    ['Box name', form.boxName],
    [],
    ['INPUTS', 'VALUE', 'UNIT / NOTE'],
    ['Entered length', lengthMm, 'mm'],
    ['Entered width', widthMm, 'mm'],
    ['Entered height', heightMm, 'mm'],
    ['Dimension type', form.dimType, 'inner / outer'],
    ['Ply', form.ply],
    ['Flute', form.flute],
    ['Caliper', n(results?.caliper), 'mm'],
    ['Inner→outer L/W factor', cfg.innerOuterLwFactor],
    ['Inner→outer H factor', cfg.innerOuterHFactor],
    ['Blank width caliper factor', cfg.widthCaliperFactor],
    ['Height allowance', heightAllowance, 'mm'],
    ['Clearance', cfg.clearanceMM, 'mm'],
    ['Glue flap', glueFlap, 'mm'],
    ['Quantity', n(form.quantity, 1), 'boxes'],
    ['Starch GSM', n(form.starchGSM, 7)],
    ['Starch rate', n(form.starchRate, 45), '₹/kg'],
    ['Joining method', form.joining.method],
    ['Pin mode', pinMode, 'Auto / Single / Double'],
    ['Wire rate', n(form.joining.wireRate, 120), '₹/kg'],
    ['Fevicol CWP GSM', n(form.joining.cwpGSM, 150)],
    ['Fevicol coverage', n(form.joining.coverage, 0.8)],
    ['Fevicol rate', n(form.joining.cwpRate, 200), '₹/kg'],
    ['Production waste', n(form.productionWastePercent, 3), '%'],
    ['Margin', n(form.marginPercent, 15), '%'],
    ['Printing', n(form.printingCost), '₹/box'],
    ['Shipping', n(form.shippingCostPerKg), '₹/kg paper'],
    ['Conversion rate', n(results?.cost?.conversionPerKg), '₹/kg finished box'],
    ['Price mode', form.priceMode, 'auto / custom / customPerKg'],
    ['Custom box price', n(form.customSellingPrice), '₹/box'],
    ['Custom selling price', n(form.customSellingPricePerKg), '₹/kg'],
    [],
    ['CALCULATIONS', 'FORMULA RESULT', 'UNIT / RULE'],
    ['Inner length', n(results?.dimensions?.inner?.L), 'mm'],
    ['Inner width', n(results?.dimensions?.inner?.W), 'mm'],
    ['Inner height', n(results?.dimensions?.inner?.H), 'mm'],
    ['Outer length', n(results?.dimensions?.outer?.L), 'mm'],
    ['Outer width', n(results?.dimensions?.outer?.W), 'mm'],
    ['Outer height', n(results?.dimensions?.outer?.H), 'mm'],
    ['Blank length', n(results?.sheet?.length), 'mm'],
    ['Blank width', n(results?.sheet?.width), 'mm'],
    ['Blank area', n(results?.sheet?.areaM2), 'm²'],
    ['Board GSM incl. starch', n(results?.weight?.boardGSM), 'g/m²'],
    ['Paper weight', n(results?.weight?.paperTotal), 'g/box'],
    ['Net blank weight', n(results?.weight?.netSheetWeight), 'g/box'],
    ['Slot waste', n(results?.weight?.slotWaste), 'g/box'],
    ['Weight before joining', n(results?.pinInfo?.basisWeightGm, results?.weight?.boxTotal), 'g'],
    ['Auto pin type', results?.pinInfo?.headType || '', `≤${AUTO_DOUBLE_PIN_THRESHOLD_GM}g single; >${AUTO_DOUBLE_PIN_THRESHOLD_GM}g double`],
    ['Pin spacing', n(results?.pinInfo?.spacing), 'mm'],
    ['Stitch points', n(results?.pinInfo?.stitchPoints), 'points'],
    ['Number of pins', n(results?.pinInfo?.pins), 'single=1/point; double=2/point'],
    ['Pin wire weight', form.joining.method === 'fevicol' ? 0 : n(results?.pinInfo?.stitchPoints) * n(results?.pinInfo?.weightPerPin), 'g'],
    ['Fevicol weight', form.joining.method === 'stitching' ? 0 : n(results?.weight?.joining) - (form.joining.method === 'both' ? n(results?.pinInfo?.stitchPoints) * n(results?.pinInfo?.weightPerPin) : 0), 'g'],
    ['Final box weight', n(results?.weight?.boxTotal), 'g/box'],
    [],
    ['COSTING', 'FORMULA RESULT', '₹/box'],
    ['Paper cost', n(results?.cost?.paperTotal)],
    ['Starch cost', n(results?.cost?.starch)],
    ['Pin cost', n(results?.cost?.pin)],
    ['Fevicol cost', n(results?.cost?.joining)],
    ['Wastage cost', n(results?.cost?.wastage)],
    ['Material subtotal', n(results?.cost?.materialSubtotal)],
    ['Conversion cost', n(results?.cost?.conversion)],
    ['Shipping cost', n(results?.cost?.shipping)],
    ['Pricing subtotal', n(results?.cost?.pricingSubtotal)],
    ['Printing cost', n(results?.cost?.printing)],
    ['Margin amount', n(results?.cost?.margin)],
    ['Selling price', n(results?.cost?.sellingPrice)],
    ['Selling price / kg', n(results?.cost?.boxRatePerKg), '₹/kg'],
    [],
    ['ORDER TOTALS', 'FORMULA RESULT'],
    ['Total order weight', n(results?.order?.totalWeightKg), 'kg'],
    ['Total order value', n(results?.order?.totalValue), '₹'],
    ['Total order cost', n(results?.order?.totalCost), '₹'],
    ['Total margin', n(results?.order?.totalMargin), '₹'],
  ]

  const calc = XLSX.utils.aoa_to_sheet(rows)
  calc['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 38 }]
  calc['!freeze'] = { xSplit: 1, ySplit: 8 }

  // Dimensions and blank formulas.
  setFormula(calc, 'B41', 'IF(LOWER(B12)="outer",B9-B16*B15,B9)', n(results?.dimensions?.inner?.L), '0.00')
  setFormula(calc, 'B42', 'IF(LOWER(B12)="outer",B10-B16*B15,B10)', n(results?.dimensions?.inner?.W), '0.00')
  setFormula(calc, 'B43', 'IF(LOWER(B12)="outer",B11-B17*B15,B11)', n(results?.dimensions?.inner?.H), '0.00')
  setFormula(calc, 'B44', 'IF(LOWER(B12)="outer",B9,B41+B16*B15)', n(results?.dimensions?.outer?.L), '0.00')
  setFormula(calc, 'B45', 'IF(LOWER(B12)="outer",B10,B42+B16*B15)', n(results?.dimensions?.outer?.W), '0.00')
  setFormula(calc, 'B46', 'IF(LOWER(B12)="outer",B11,B43+B17*B15)', n(results?.dimensions?.outer?.H), '0.00')
  setFormula(calc, 'B47', '2*(B41+B15)+2*(B42+B15)+B21', n(results?.sheet?.length), '0.00')
  setFormula(calc, 'B48', 'B42+B43+B18*B15+B19+B20', n(results?.sheet?.width), '0.00')
  setFormula(calc, 'B49', '(B47/1000)*(B48/1000)', n(results?.sheet?.areaM2), '0.000000')
  setFormula(calc, 'B50', `SUMPRODUCT(Layers!C2:C${form.layers.length + 1},Layers!F2:F${form.layers.length + 1})+B23*(${form.layers.length}-1)`, n(results?.weight?.boardGSM), '0.00')
  setFormula(calc, 'B51', `SUM(Layers!G2:G${form.layers.length + 1})`, n(results?.weight?.paperTotal), '0.00')
  setFormula(calc, 'B52', 'B49*B50', n(results?.weight?.netSheetWeight), '0.00')
  setFormula(calc, 'B53', `4*B42*${MACHINE_LIMITS.slotBladeWidthMM}/1000000*B50`, n(results?.weight?.slotWaste), '0.00')
  setFormula(calc, 'B54', 'MAX(0,B52-B53)', n(results?.pinInfo?.basisWeightGm, results?.weight?.boxTotal), '0.00')
  setFormula(calc, 'B55', `IF(OR(LOWER(B26)="single",LOWER(B26)="double"),LOWER(B26),IF(B54>${AUTO_DOUBLE_PIN_THRESHOLD_GM},"double","single"))`, results?.pinInfo?.headType || 'single')
  setFormula(calc, 'B56', `IF(B55="double",${ADHESIVE_DEFAULTS.stitching.spacing.double},${ADHESIVE_DEFAULTS.stitching.spacing.single})`, n(results?.pinInfo?.spacing), '0')
  setFormula(calc, 'B57', `IF(OR(LOWER(B25)="stitching",LOWER(B25)="both"),MAX(${ADHESIVE_DEFAULTS.stitching.minPins},ROUNDUP(B46/B56,0)),0)`, n(results?.pinInfo?.stitchPoints), '0')
  setFormula(calc, 'B58', 'B57*IF(B55="double",2,1)', n(results?.pinInfo?.pins), '0')
  setFormula(calc, 'B59', `B57*IF(B55="double",${ADHESIVE_DEFAULTS.stitching.weightPerPin.double},${ADHESIVE_DEFAULTS.stitching.weightPerPin.single})`, form.joining.method === 'fevicol' ? 0 : n(results?.pinInfo?.stitchPoints) * n(results?.pinInfo?.weightPerPin), '0.00')
  setFormula(calc, 'B60', 'IF(OR(LOWER(B25)="fevicol",LOWER(B25)="both"),(B21/1000)*(B48/1000)*B28*B29,0)', form.joining.method === 'stitching' ? 0 : n(results?.weight?.joining) - (form.joining.method === 'both' ? n(results?.pinInfo?.stitchPoints) * n(results?.pinInfo?.weightPerPin) : 0), '0.00')
  setFormula(calc, 'B61', 'B54+B59+B60', n(results?.weight?.boxTotal), '0.00')

  // Cost formulas.
  setFormula(calc, 'B64', `SUM(Layers!H2:H${form.layers.length + 1})`, n(results?.cost?.paperTotal), '₹0.0000')
  setFormula(calc, 'B65', `B49*B23*(${form.layers.length}-1)/1000*B24`, n(results?.cost?.starch), '₹0.0000')
  setFormula(calc, 'B66', 'B59/1000*B27', n(results?.cost?.pin), '₹0.0000')
  setFormula(calc, 'B67', 'B60/1000*B30', n(results?.cost?.joining), '₹0.0000')
  setFormula(calc, 'B68', '(B64+B65+B66+B67)*B31/100', n(results?.cost?.wastage), '₹0.0000')
  setFormula(calc, 'B69', 'SUM(B64:B68)', n(results?.cost?.materialSubtotal), '₹0.0000')
  setFormula(calc, 'B70', 'B61/1000*B35', n(results?.cost?.conversion), '₹0.0000')
  setFormula(calc, 'B71', 'B51/1000*B34', n(results?.cost?.shipping), '₹0.0000')
  setFormula(calc, 'B72', 'SUM(B69:B71)', n(results?.cost?.pricingSubtotal), '₹0.0000')
  setFormula(calc, 'B73', 'B33', n(results?.cost?.printing), '₹0.0000')
  setFormula(calc, 'B74', 'IF(LOWER(B36)="custom",B37-B72-B73,IF(LOWER(B36)="customperkg",B38*B61/1000-B72-B73,B72*B32/100))', n(results?.cost?.margin), '₹0.0000')
  setFormula(calc, 'B75', 'IF(LOWER(B36)="custom",B37,IF(LOWER(B36)="customperkg",B38*B61/1000,B72+B73+B74))', n(results?.cost?.sellingPrice), '₹0.0000')
  setFormula(calc, 'B76', 'IF(B61>0,B75/(B61/1000),0)', n(results?.cost?.boxRatePerKg), '₹0.00')

  setFormula(calc, 'B79', 'B61*B22/1000', n(results?.order?.totalWeightKg), '0.00')
  setFormula(calc, 'B80', 'B75*B22', n(results?.order?.totalValue), '₹0.00')
  setFormula(calc, 'B81', '(B72+B73)*B22', n(results?.order?.totalCost), '₹0.00')
  setFormula(calc, 'B82', 'B74*B22', n(results?.order?.totalMargin), '₹0.00')

  setFormat(calc, ['B9', 'B10', 'B11', 'B15', 'B19', 'B20', 'B21'], '0.00')
  setFormat(calc, ['B24', 'B27', 'B30', 'B33', 'B34', 'B35', 'B37', 'B38'], '₹0.00')

  const layerRows: (string | number)[][] = [
    ['Layer', 'Paper type', 'GSM', 'BF', 'Rate ₹/kg', 'Take-up', 'Weight g/box', 'Cost ₹/box', 'BS kg/cm²'],
    ...form.layers.map((layer) => [
      layer.name,
      layer.paperType,
      n(layer.gsm),
      n(layer.bf),
      n(layer.rate),
      n(layer.takeUp, 1),
      0,
      0,
      0,
    ]),
  ]
  const layers = XLSX.utils.aoa_to_sheet(layerRows)
  layers['!cols'] = [
    { wch: 22 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 14 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
  ]
  for (let i = 0; i < form.layers.length; i++) {
    const row = i + 2
    const resultLayer = results?.weight?.layers?.[i]
    const resultCost = results?.cost?.layers?.[i]
    setFormula(layers, `G${row}`, `'Box Calculation'!$B$49*C${row}*F${row}`, n(resultLayer?.weightGm), '0.00')
    setFormula(layers, `H${row}`, `G${row}/1000*E${row}`, n(resultCost?.cost), '₹0.0000')
    setFormula(layers, `I${row}`, `D${row}*C${row}/1000`, n(form.layers[i].bf) * n(form.layers[i].gsm) / 1000, '0.000')
  }

  const snapshot = XLSX.utils.aoa_to_sheet([
    ['RESULT SNAPSHOT (generated by PAMA Suite calculator)'],
    ['Generated at', new Date().toISOString()],
    ['Customer', form.customerName],
    ['Box', form.boxName],
    ['Dimensions', `${lengthMm} × ${widthMm} × ${heightMm} mm (${form.dimType})`],
    ['Ply / Flute', `${form.ply} / ${form.flute}`],
    ['Blank', `${n(results?.sheet?.length).toFixed(2)} × ${n(results?.sheet?.width).toFixed(2)} mm`],
    ['Box weight', n(results?.weight?.boxTotal), 'g'],
    ['Pin type', results?.pinInfo?.headType || 'No stitching'],
    ['Number of pins', n(results?.pinInfo?.pins)],
    ['Selling price', n(results?.cost?.sellingPrice), '₹/box'],
    ['Order quantity', n(form.quantity)],
    ['Order value', n(results?.order?.totalValue), '₹'],
  ])
  snapshot['!cols'] = [{ wch: 24 }, { wch: 42 }, { wch: 14 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, calc, 'Box Calculation')
  XLSX.utils.book_append_sheet(wb, layers, 'Layers')
  XLSX.utils.book_append_sheet(wb, snapshot, 'Result Snapshot')
  ;(wb as any).CalcPr = { calcMode: 'auto', fullCalcOnLoad: '1', forceFullCalc: '1' }
  return wb
}

export function downloadBoxCalcExcel(
  form: BoxCalcForm,
  results: CalcResult,
  settings?: BoxSheetSettings | null,
): string {
  const wb = buildBoxCalcWorkbook(form, results, settings)
  const date = new Date().toISOString().slice(0, 10)
  const filename = `Box_Calculation_${safeFilename(form.customerName)}_${safeFilename(form.boxName)}_${date}.xlsx`
  XLSX.writeFile(wb, filename)
  return filename
}
