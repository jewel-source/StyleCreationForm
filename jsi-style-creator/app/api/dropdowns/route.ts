import { NextResponse } from 'next/server'
import {
  fetchAll, SC_BASE,
  TBL_STONE_TYPE, TBL_CATEGORY, TBL_COLORSTONE, TBL_METAL, TBL_SIZE, TBL_VENDOR
} from '@/lib/nocodb'

export async function GET() {
  try {
    const [stoneTypes, categories, colorstones, metals, sizes, vendors] = await Promise.all([
      fetchAll(SC_BASE, TBL_STONE_TYPE),
      fetchAll(SC_BASE, TBL_CATEGORY),
      fetchAll(SC_BASE, TBL_COLORSTONE),
      fetchAll(SC_BASE, TBL_METAL),
      fetchAll(SC_BASE, TBL_SIZE),
      fetchAll(SC_BASE, TBL_VENDOR),
    ])
    return NextResponse.json({ stoneTypes, categories, colorstones, metals, sizes, vendors })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}