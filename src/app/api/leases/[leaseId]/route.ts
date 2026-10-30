import { NextResponse } from 'next/server'
import { getLeaseDetails } from '@/features/leases/service'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/http'

export async function GET(_request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    const ctx = await requireAuth()
    const { leaseId } = await params
    return NextResponse.json(await getLeaseDetails(ctx, leaseId))
  } catch (error) {
    return errorResponse(error)
  }
}
