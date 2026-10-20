// Style # composition rules shared by the single-style form and the Excel bulk upload.

export const NO_SIZE_CATS   = ['Earrings','Earring','Pendant','Brooch','Cufflink','Set','Anklet']
export const SIZE_CATS      = ['Ring','Bracelet','Necklace','Bangle','Band']
export const GEMSTONE_TYPES = ['Natural Gemstone','Lab Gem']

export function buildStyleNumber(
  stCode: string, catCode: string, midCode: string,
  mCode: string, uidNumber: number | null, sCode: string
): string | null {
  const uidPart = uidNumber !== null ? String(uidNumber).padStart(4, '0') : ''
  if (!stCode || !catCode || !midCode || !mCode || !uidPart || !sCode) return null
  return stCode + catCode + midCode + mCode + uidPart + sCode
}

// Gemstones use the colorstone code; everything else uses CTW x100 (4 digits),
// falling back to the colorstone code when no CTW is given. CTW >= 100 keeps
// only the first 4 digits (250 -> 25000 -> 2500).
export function buildMidCode(stName: string, ctw: string, colorstoneCode: string): string {
  if (GEMSTONE_TYPES.includes(stName)) return colorstoneCode
  if (ctw !== '' && !isNaN(parseFloat(ctw)) && parseFloat(ctw) >= 0) {
    return String(Math.round(parseFloat(ctw) * 100)).padStart(4, '0').slice(0, 4)
  }
  return colorstoneCode
}
