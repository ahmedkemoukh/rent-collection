import { NextResponse } from 'next/server'
import { createLease } from '@/features/leases/service'
import { requireAuth } from '@/lib/auth'
import { ApiError, errorResponse } from '@/lib/http'

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth()
    const body: unknown = await request.json().catch(() => {
      throw new ApiError(400, 'Request body must be JSON')
    })
    const lease = await createLease(ctx, body)
    return NextResponse.json(lease, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
