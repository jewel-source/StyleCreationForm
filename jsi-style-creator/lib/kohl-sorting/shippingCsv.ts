import { dscoField, type ParsedDsco } from './dsco'

export const SHIPPING_IMPORT_COLUMNS = [
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

export const LINE_ITEM_DETAIL_FIELD_MAP: Record<string, string> = {
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

export function buildShippingCsv(dsco: ParsedDsco, orderedPoNumbers: string[], company: string): string {
  const lines = [SHIPPING_IMPORT_COLUMNS.map(csvEscape).join(',')]
  const tpInfo = TP_INFO_BY_COMPANY[company] ?? {}
  const poField = dsco.shape === 'shipping-import' ? 'Reference1' : 'po_number'

  const rowByPo = new Map<string, Record<string, any>>()
  for (const row of dsco.rows) {
    const po = dscoField(row, poField)
    if (!po || rowByPo.has(po)) continue
    rowByPo.set(po, row)
  }

  for (const po of orderedPoNumbers) {
    const row = rowByPo.get(po)
    if (!row) continue

    const line = dsco.shape === 'shipping-import'
      ? SHIPPING_IMPORT_COLUMNS.map(col => csvEscape(row[col]))
      : SHIPPING_IMPORT_COLUMNS.map(col => {
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

  return lines.join('\r\n') + '\r\n'
}
