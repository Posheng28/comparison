import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'data', 'fund-rank.json')
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load fund rank data', detail: String(err) },
      { status: 500 }
    )
  }
}
