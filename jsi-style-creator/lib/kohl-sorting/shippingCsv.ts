import { dscoField, type ParsedDsco } from './dsco'

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

// Confirmed 2026-07-23 against a real Dsco_Orders_Download_*.xls (the
// line-item-detail shape) — these ShipTo*/ShipmentInformation* columns have
// direct counterparts in that export, under different names than the
// shipping-import shape uses natively. Columns with no confirmed source
// (ShipToCustomerID, ShipToAddress3, ShipmentInformationBillTransportationTo,
// PackagePackageType, PackageWeight, Reference2) stay blank per CLAUDE.md —
// don't guess fields we haven't verified against a real file.
const LINE_ITEM_DETAIL_FIELD_MAP: Record<string, string> = {
  ShipToAttention: 'ship_attention',
  ShipToAddress1: 'ship_address_1',
  ShipToAddress2: 'ship_address_2',
  ShipToCountryTerritory: 'ship_country',
  ShipToPostalCode: 'ship_postal',
  ShipToCityorTown: 'ship_city',
  ShipToStateProvinceCounty: 'ship_region',
  ShipToTelephone: 'ship_phone',
  ShipToEmailAddress: 'ship_email',
  ShipmentInformationServiceType: 'shipping_service_level_code',
}

// TPCompanyName/TPCompanyAddress/TPCountry/TPPostalCode/TPCity/TPState/
// Tpaccount are the retailer's own third-party shipping-account info (e.g.
// their UPS account for billing transportation) — fixed per company, not
// derived from any per-order DSCO field. Confirmed 2026-07-23 for KOHLS.
const TP_INFO_BY_COMPANY: Record<string, Record<string, string>> = {
  KOHLS: {
    TPCompanyName: 'KOHLS.COM',
    TPCompanyAddress: 'N56 W17000 RIDGEWOOD DRIVE',
    TPCountry: 'United States',
    TPPostalCode: '53051',
    TPCity: 'MENOMONEE FALLS',
    TPState: 'WI',
    Tpaccount: '6Y7F31',
  },
}

/**
 * Pass-through of the shipping-import-shape columns when that's the
 * uploaded shape. If the line-item-detail shape was uploaded instead
 * (one row per line item, many rows per PO), collapse to one shipment row
 * per distinct PO (first occurrence, same order as `dsco.poOrder`) and map
 * the fields confirmed above, plus the company's fixed TP* info; anything
 * with no confirmed source stays blank, matching legacy behavior for those
 * specific fields.
 */
export function buildShippingCsv(dsco: ParsedDsco, company: string): string {
  const lines = [SHIPPING_IMPORT_COLUMNS.map(csvEscape).join(',')]
  const tpInfo = TP_INFO_BY_COMPANY[company] ?? {}

  if (dsco.shape === 'shipping-import') {
    for (const row of dsco.rows) {
      lines.push(SHIPPING_IMPORT_COLUMNS.map(col => csvEscape(row[col])).join(','))
    }
  } else {
    const rowByPo = new Map<string, Record<string, any>>()
    for (const row of dsco.rows) {
      const po = dscoField(row, 'po_number')
      if (!po || rowByPo.has(po)) continue
      rowByPo.set(po, row)
    }

    for (const po of dsco.poOrder) {
      const row = rowByPo.get(po) ?? {}
      const line = SHIPPING_IMPORT_COLUMNS.map(col => {
        if (col === 'Reference1') return csvEscape(po)
        if (col === 'ShipToCompanyorName') {
          return csvEscape(`${dscoField(row, 'ship_first_name')} ${dscoField(row, 'ship_last_name')}`.trim())
        }
        if (col in tpInfo) return csvEscape(tpInfo[col])
        const mapped = LINE_ITEM_DETAIL_FIELD_MAP[col]
        return mapped ? csvEscape(dscoField(row, mapped)) : ''
      })
      lines.push(line.join(','))
    }
  }

  return lines.join('\r\n') + '\r\n'
}
