import type { ParsedDsco } from './dsco'

const SHIPPING_IMPORT_COLUMNS = [
  'ShipToCustomerID', 'ShipToCompanyorName', 'ShipToAttention', 'ShipToAddress1',
  'ShipToAddress2', 'ShipToAddress3', 'ShipToCountryTerritory', 'ShipToPostalCode',
  'ShipToCityorTown', 'ShipToStateProvinceCounty', 'ShipToTelephone', 'ShipToEmailAddress',
  'ShipmentInformationServiceType', 'ShipmentInformationBillTransportationTo',
  'PackagePackageType', 'PackageWeight', 'Reference1', 'Reference2',
  'TPCompanyName', 'TPCompanyAddress', 'TPCountry', 'TPPostalCode', 'TPCity', 'TPState', 'Tpaccount',
]

function csvEscape(val: unknown): string {
  const s = String(val ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Pass-through of the shipping-import-shape columns when that's the
 * uploaded shape. If the line-item-detail shape was uploaded instead, emit
 * the same header with only directly-matching fields filled (PO via
 * Reference1) — everything else blank, matching the spec's "mostly blank,
 * filled later by Link Tracking" note.
 */
export function buildShippingCsv(dsco: ParsedDsco): string {
  const lines = [SHIPPING_IMPORT_COLUMNS.map(csvEscape).join(',')]
  const refIdx = SHIPPING_IMPORT_COLUMNS.indexOf('Reference1')

  if (dsco.shape === 'shipping-import') {
    for (const row of dsco.rows) {
      lines.push(SHIPPING_IMPORT_COLUMNS.map(col => csvEscape(row[col])).join(','))
    }
  } else {
    // one row per line item in this shape — one shipment row per distinct PO instead
    for (const po of dsco.poOrder) {
      const blank = SHIPPING_IMPORT_COLUMNS.map(() => '')
      blank[refIdx] = csvEscape(po)
      lines.push(blank.join(','))
    }
  }

  return lines.join('\r\n') + '\r\n'
}
