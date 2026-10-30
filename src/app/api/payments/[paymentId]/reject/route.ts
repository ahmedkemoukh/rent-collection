import { NextResponse } from 'next/server'
import { rejectPayment } from '@/features/payments/service'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/http'

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    const ctx = await requireAuth()
    const { paymentId } = await params
    const body: unknown = await request.json().catch(() => ({}))
    return NextResponse.json(await rejectPayment(ctx, paymentId, body))
  } catch (error) {
    return errorResponse(error)
  }
}
