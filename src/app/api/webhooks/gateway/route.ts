import { NextResponse } from 'next/server'
import { handleGatewayWebhook } from '@/features/payments/gateway'
import { ApiError, errorResponse } from '@/lib/http'

// Called by the payment gateway, not by a user: no session, authenticated by its HMAC signature.
// Never log the secret key or the callback payload.
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/x-www-form-urlencoded')) {
      throw new ApiError(400, 'Expected application/x-www-form-urlencoded')
    }
    const params = new URLSearchParams(await request.text())
    const fields: Record<string, string> = {}
    for (const [key, value] of params) {
      // A repeated field is ambiguous to sign, so it is treated as an invalid signature.
      if (key in fields) throw new ApiError(401, 'Invalid signature')
      fields[key] = value
    }
    const outcome = await handleGatewayWebhook(fields)
    return NextResponse.json({ ok: true, outcome })
  } catch (error) {
    return errorResponse(error)
  }
}
