import { NextResponse } from 'next/server'
import { getCollections } from '@/features/reports/service'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/http'

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth()
    const { searchParams } = new URL(request.url)
    return NextResponse.json(await getCollections(ctx, searchParams.get('from'), searchParams.get('to')))
  } catch (error) {
    return errorResponse(error)
  }
}
