import 'server-only'
import type { AuthContext } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { ApiError } from '@/lib/http'
import { senToNumber } from '@/lib/money'

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/
const MAX_MONTHS = 120

function monthIndex(value: string | null): number | null {
  const match = MONTH_PATTERN.exec(value ?? '')
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null
}

// Total of approved payments per calendar month of received_at in Malaysia time,
// one entry per month of the range, including months with nothing collected.
export async function getCollections(
  ctx: AuthContext,
  from: string | null,
  to: string | null,
): Promise<{ month: string; collectedSen: number }[]> {
  if (ctx.role === 'tenant') throw new ApiError(403, 'Only staff and managers can see reports')

  const start = monthIndex(from)
  const end = monthIndex(to)
  if (start === null || end === null) throw new ApiError(400, 'from and to must be months written as YYYY-MM')
  if (end < start) throw new ApiError(400, 'from must not be after to')
  if (end - start + 1 > MAX_MONTHS) throw new ApiError(400, `The range is limited to ${MAX_MONTHS} months`)

  // Month boundaries are midnight in Kuala Lumpur, converted to instants by the database,
  // so the server's and the session's timezone play no part.
  const rows = await prisma.$queryRaw<{ month: string; collected: bigint }[]>`
    SELECT to_char(m.month_start, 'YYYY-MM') AS month,
           COALESCE(SUM(p.amount_sen), 0)::bigint AS collected
    FROM generate_series(${`${from}-01`}::timestamp, ${`${to}-01`}::timestamp, interval '1 month') AS m(month_start)
    LEFT JOIN public.payments p
      ON p.org_id = ${ctx.orgId}::uuid
     AND p.status = 'approved'
     AND p.received_at >= (m.month_start AT TIME ZONE 'Asia/Kuala_Lumpur')
     AND p.received_at < ((m.month_start + interval '1 month') AT TIME ZONE 'Asia/Kuala_Lumpur')
    GROUP BY m.month_start
    ORDER BY m.month_start`

  return rows.map((row) => ({ month: row.month, collectedSen: senToNumber(row.collected) }))
}
