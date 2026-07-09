const API_KEY  = process.env.NOCODB_API_KEY!
const BASE_URL = process.env.NOCODB_BASE_URL!

export const SC_BASE  = 'p5pig2ru4284ft2'
export const SC_TABLE = 'm2ei89b5zqhr1cu'

export const TBL_STONE_TYPE = 'mu6pzbj9k7z1ehs'
export const TBL_CATEGORY   = 'm4cym8kn8kxynzs'
export const TBL_COLORSTONE = 'm6npmo8juryjkz6'
export const TBL_METAL      = 'mxbwq6yta71dia1'
export const TBL_SIZE       = 'mudzx7zipojwm7o'

export const UID_BASE = 'pbe18uecvc3ly66'

export const UID_TABLES: Record<string, string> = {
  Ring:     'm5wdqbrjc2yqr2f',
  Earrings: 'm4jbmsd175z1eom',
  Earring:  'm4jbmsd175z1eom',
  Pendant:  'mhcwzcfekl0lhhh',
}

export async function fetchAll(baseId: string, tableId: string, fields = '', where = ''): Promise<any[]> {
  let page = 1
  const limit = 1000
  const all: any[] = []
  while (true) {
    let url = `${BASE_URL}/api/v1/db/data/noco/${baseId}/${tableId}?limit=${limit}&offset=${(page - 1) * limit}`
    if (fields) url += `&fields=${encodeURIComponent(fields)}`
    if (where)  url += `&where=${encodeURIComponent(where)}`
    const res  = await fetch(url, { headers: { 'xc-token': API_KEY }, cache: 'no-store' })
    const data = await res.json()
    const list = data.list || []
    all.push(...list)
    if (all.length >= (data.pageInfo?.totalRows ?? all.length)) break
    page++
  }
  return all
}

export async function patchRow(baseId: string, tableId: string, rowId: number, body: object) {
  return fetch(`${BASE_URL}/api/v1/db/data/noco/${baseId}/${tableId}/${rowId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'xc-token': API_KEY },
    body: JSON.stringify(body),
  })
}

export async function createRow(baseId: string, tableId: string, body: object) {
  return fetch(`${BASE_URL}/api/v1/db/data/noco/${baseId}/${tableId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xc-token': API_KEY },
    body: JSON.stringify(body),
  })
}