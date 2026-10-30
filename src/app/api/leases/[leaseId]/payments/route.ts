import { NextResponse } from 'next/server'
import { recordPayment } from '@/features/payments/service'
import { requireAuth } from '@/lib/auth'
import { ApiError, errorResponse } from '@/lib/http'

export async function POST(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    const ctx = await requireAuth()
    const { leaseId } = await params
    const body: unknown = await request.json().catch(() => {
      throw new ApiError(400, 'Request body must be JSON')
    })
    const payment = await recordPayment(ctx, leaseId, body)
    return NextResponse.json(payment, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
