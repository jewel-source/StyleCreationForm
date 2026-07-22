import { fetchAll, SKU_BASE, SKU_TABLE } from '@/lib/nocodb'

export interface SkuCatalogEntry {
  styleNumber: string
  cost: number
  rightClickStyleNumber: string
}

/** UPC (the `Sku #` field, despite its name) -> catalog entry. */
export async function fetchSkuCatalogMap(): Promise<Map<string, SkuCatalogEntry>> {
  const rows = await fetchAll(SKU_BASE, SKU_TABLE)
  const map = new Map<string, SkuCatalogEntry>()
  for (const row of rows) {
    const upc = String(row['Sku #'] ?? '').trim()
    if (!upc) continue
    map.set(upc, {
      styleNumber: String(row['Style #'] ?? '').trim(),
      cost: parseFloat(String(row['Cost'] ?? '').replace(/[$,]/g, '')) || 0,
      rightClickStyleNumber: String(row['Right Click Style #'] ?? '').trim(),
    })
  }
  return map
}
