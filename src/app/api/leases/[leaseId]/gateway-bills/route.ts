import { NextResponse } from 'next/server'
import { createGatewayBill } from '@/features/payments/gateway'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/http'

export async function POST(_request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    const ctx = await requireAuth()
    const { leaseId } = await params
    return NextResponse.json(await createGatewayBill(ctx, leaseId), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
