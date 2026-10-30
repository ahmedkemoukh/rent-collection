import { NextResponse } from 'next/server'
import { approvePayment } from '@/features/payments/service'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/http'

export async function POST(_request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    const ctx = await requireAuth()
    const { paymentId } = await params
    return NextResponse.json(await approvePayment(ctx, paymentId))
  } catch (error) {
    return errorResponse(error)
  }
}
