const STORAGE_KEY = 'pama_box_sheet_settings'

export interface BoxSheetMachineSettings {
  workingDeckleMM: number
  sideTrimMM: number
  maxSheetLengthMM: number
  maxSheetLength2PieceMM: number
  maxSheetLength3PieceMM: number
  lengthTrimMM: number
}

/** User-adjustable parameters for RSC blank / sheet sizing only. */
export interface BoxSheetSettings {
  innerOuterLwFactor: number
  innerOuterHFactor: number
  clearanceMM: number
  glueFlapDefaults: Record<string, number>
  caliperTable: Record<string, number>
  machine: BoxSheetMachineSettings
}

const DEFAULT_CALIPER_TABLE: Record<string, number> = {
  '3-ply-A': 5.0,
  '3-ply-B': 3.0,
  '3-ply-C': 3.2,
  '3-ply-E': 1.6,
  '5-ply-BC': 7.0,
  '5-ply-CC': 6.4,
  '5-ply-BE': 4.5,
  '5-ply-EB': 4.5,
  '7-ply-ABC': 11.0,
  '7-ply-BCB': 9.5,
  '7-ply-BCC': 10.5,
  '7-ply-CCC': 9.6,
}

export const DEFAULT_BOX_SHEET_SETTINGS: BoxSheetSettings = {
  innerOuterLwFactor: 1.5,
  innerOuterHFactor: 2.7,
  clearanceMM: 6,
  glueFlapDefaults: { '3-ply': 35, '5-ply': 45, '7-ply': 55 },
  caliperTable: { ...DEFAULT_CALIPER_TABLE },
  machine: {
    workingDeckleMM: 1702,
    sideTrimMM: 10,
    maxSheetLengthMM: 2286,
    maxSheetLength2PieceMM: 4572,
    maxSheetLength3PieceMM: 6858,
    lengthTrimMM: 10,
  },
}

export const CALIPER_TABLE_KEYS = Object.keys(DEFAULT_CALIPER_TABLE).sort()

export function mergeBoxSheetSettings(partial?: Partial<BoxSheetSettings> | null): BoxSheetSettings {
  const base = DEFAULT_BOX_SHEET_SETTINGS
  if (!partial) {
    return {
      ...base,
      glueFlapDefaults: { ...base.glueFlapDefaults },
      caliperTable: { ...base.caliperTable },
      machine: { ...base.machine },
    }
  }
  return {
    innerOuterLwFactor: partial.innerOuterLwFactor ?? base.innerOuterLwFactor,
    innerOuterHFactor: partial.innerOuterHFactor ?? base.innerOuterHFactor,
    clearanceMM: partial.clearanceMM ?? base.clearanceMM,
    glueFlapDefaults: { ...base.glueFlapDefaults, ...partial.glueFlapDefaults },
    caliperTable: { ...base.caliperTable, ...partial.caliperTable },
    machine: { ...base.machine, ...partial.machine },
  }
}

export function loadBoxSheetSettings(): BoxSheetSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return mergeBoxSheetSettings()
    return mergeBoxSheetSettings(JSON.parse(raw) as Partial<BoxSheetSettings>)
  } catch {
    return mergeBoxSheetSettings()
  }
}

export function saveBoxSheetSettings(settings: BoxSheetSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function resetBoxSheetSettings(): BoxSheetSettings {
  localStorage.removeItem(STORAGE_KEY)
  return mergeBoxSheetSettings()
}
