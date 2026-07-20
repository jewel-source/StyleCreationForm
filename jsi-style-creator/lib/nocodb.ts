const API_KEY  = process.env.NOCODB_API_KEY!
const BASE_URL = process.env.NOCODB_BASE_URL!

export const SC_BASE  = 'p5pig2ru4284ft2'
export const SC_TABLE = 'm2ei89b5zqhr1cu'

export const SUBMIT_BASE  = 'pbz6yuf1ab25wde'
export const SUBMIT_TABLE = 'mdyd9dhavs9hbi5'

export const TBL_STONE_TYPE = 'mu6pzbj9k7z1ehs'
export const TBL_CATEGORY   = 'm4cym8kn8kxynzs'
export const TBL_COLORSTONE = 'm6npmo8juryjkz6'
export const TBL_METAL      = 'mxbwq6yta71dia1'
export const TBL_SIZE       = 'mudzx7zipojwm7o'
export const TBL_VENDOR     = 'mshfyzmvvydqpvy'

export const UID_BASE = 'pbe18uecvc3ly66'

// Nested by Stone Type -> Category -> table ID
export const UID_TABLES: Record<string, Record<string, string>> = {
  'Lab Diamond': {
    Ring:      'mfmus851vbmu2ij',
    Earrings:  'mgqpbfub39qqbgb',
    Earring:   'mgqpbfub39qqbgb',
    Pendant:   'mf6j0vpqaeyrrar',
    Necklace:  'mt7bdfmvdablg77',
    Bracelet:  'mtrhkm3cr3mhw7s',
    Bangle:    'm2txsqct7he087u',
    Cufflink:  'mumel64d3luco2z',
    Brooch:    'm4mppod4okuj6jm',
  },
  'Natural Diamond': {
    Earrings:  'mqvtj5mp2yhg954',
    Earring:   'mqvtj5mp2yhg954',
    Pendant:   'mfmjpwzrc0gbwux',
    Necklace:  'mgn09qdeu50pbad',
    Bangle:    'mn15p2nm5aq5vje',
    Anklet:    'mfxzqnhz06ctptb',
    Ring:      'mbzf9ajehhh114u',
    Bracelet:  'm7hnvbybd0tz2n4',
    // Charm intentionally omitted for now
  },
}

// Nested by Stone Type -> Category -> prefix used in JSI Style#
// Empty string means: plain zero-padded numbers, no letter prefix
export const PREFIX: Record<string, Record<string, string>> = {
  'Lab Diamond': {
    Ring:      'A',
    Pendant:   'A',
    Earrings:  '',
    Earring:   '',
    Necklace:  '',
    Bracelet:  '',
    Bangle:    'AABG',
    Cufflink:  'AAC',
    Brooch:    '',
  },
  'Natural Diamond': {
    Earrings:  '',
    Earring:   '',
    Pendant:   '',
    Necklace:  '',
    Bangle:    '',
    Anklet:    '',
    Ring:      '',
    Bracelet:  '',
  },
}

// Starting UID number by Stone Type -> Category
export const START_UID: Record<string, Record<string, number>> = {
  'Lab Diamond': {
    Ring:      1644,
    Pendant:   507,
    Necklace:  447,
    Earrings:  928,
    Earring:   928,
    Bracelet:  241,
    Bangle:    46,
  },
  'Natural Diamond': {
    Earrings:  3027,
    Earring:   3027,
    Pendant:   3322,
    Necklace:  491,
    Bangle:    276,
    Anklet:    4,
    Ring:      6842,
    Bracelet:  1532,
  },
}

export const CATEGORY_MAP: Record<string, string> = {
  Ring:      'RING',
  Earrings:  'EARRINGS',
  Earring:   'EARRINGS',
  Pendant:   'PENDANT',
  Necklace:  'NECKLACE',
  Bracelet:  'BRACELET',
  Bangle:    'BANGLE',
  Cufflink:  'CUFFLINK',
  Brooch:    'BROOCH',
  Set:       'SET',
  Anklet:    'ANKLET',
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