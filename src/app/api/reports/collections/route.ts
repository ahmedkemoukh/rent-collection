import { NextResponse, connection } from 'next/server'
import { getCollections } from '@/features/reports/service'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/http'

export async function GET(request: Request) {
  // Per-request only: never prerendered at build time. Outside the try so the build-time abort is not logged as an error.
  await connection()
  try {
    const ctx = await requireAuth()
    const { searchParams } = new URL(request.url)
    return NextResponse.json(await getCollections(ctx, searchParams.get('from'), searchParams.get('to')))
  } catch (error) {
    return errorResponse(error)
  }
}
