import 'server-only'
import { NextResponse } from 'next/server'

// Thrown anywhere in server code; turned into `{ "error": message }` with the given status.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  // Never echo internal errors (SQL, stack traces) to the caller.
  console.error(error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
