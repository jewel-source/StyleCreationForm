import { NextRequest, NextResponse } from 'next/server'
import { parseInventoryFile } from '@/lib/kohl-sorting/inventory'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const inventory = formData.get('inventory') as File | null
    if (!inventory) {
      return NextResponse.json({ error: 'Inventory file (CSV/XLS) is required' }, { status: 400 })
    }

    const inventoryBuf = Buffer.from(await inventory.arrayBuffer())
    const balanceByStyle = parseInventoryFile(inventoryBuf, inventory.name)

    return NextResponse.json({ balanceByStyle: Array.from(balanceByStyle.entries()) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
