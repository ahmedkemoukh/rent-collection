export type InvoiceKind = 'deposit' | 'rent'

export interface ScheduledInvoice {
  kind: InvoiceKind
  periodIndex: number | null // 0, 1, 2... for rent; null for the deposit
  periodStart: string | null // 'YYYY-MM-DD'; null for the deposit
  periodEnd: string | null // 'YYYY-MM-DD', inclusive; null for the deposit
  dueDate: string // 'YYYY-MM-DD'
  amountSen: number // integer
}

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'

const DAY_MS = 86_400_000
const MALAYSIA_OFFSET_MS = 8 * 3_600_000 // Asia/Kuala_Lumpur is UTC+8 with no daylight saving
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

interface CalendarDate {
  year: number
  month: number // 1-12
  day: number
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function parseDate(value: string, field: string): CalendarDate {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null
  if (!match) throw new Error(`${field} must be a date written as YYYY-MM-DD`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`${field} is not a real calendar date: "${value}"`)
  }
  return { year, month, day }
}

// Whole days since 1970-01-01. setUTCFullYear avoids Date.UTC mapping years 0-99 to 1900-1999.
function toDayNumber({ year, month, day }: CalendarDate): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getTime() / DAY_MS
}

function formatDayNumber(dayNumber: number): string {
  const date = new Date(dayNumber * DAY_MS)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Start date plus k calendar months, always counted from the start date,
// clamped to the last day of the target month.
function anchorDayNumber(start: CalendarDate, k: number): number {
  const monthIndex = start.month - 1 + k
  const year = start.year + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1
  const day = Math.min(start.day, daysInMonth(year, month))
  return toDayNumber({ year, month, day })
}

// rentSen * daysUsed / fullDays, rounded half up, in integer arithmetic.
function prorateSen(rentSen: number, daysUsed: number, fullDays: number): number {
  const numerator = BigInt(rentSen) * BigInt(daysUsed) * BigInt(2) + BigInt(fullDays)
  return Number(numerator / (BigInt(fullDays) * BigInt(2)))
}

export function generateSchedule(lease: {
  startDate: string // 'YYYY-MM-DD'
  endDate: string // 'YYYY-MM-DD', inclusive (the tenant's last day)
  monthlyRentSen: number
  depositSen: number
}): ScheduledInvoice[] {
  const start = parseDate(lease.startDate, 'startDate')
  const end = parseDate(lease.endDate, 'endDate')
  const startDay = toDayNumber(start)
  const endDay = toDayNumber(end)
  if (endDay < startDay) throw new Error('endDate must not be before startDate')
  if (!Number.isSafeInteger(lease.monthlyRentSen) || lease.monthlyRentSen <= 0) {
    throw new Error('monthlyRentSen must be a positive integer')
  }
  if (!Number.isSafeInteger(lease.depositSen) || lease.depositSen < 0) {
    throw new Error('depositSen must be a non-negative integer')
  }

  const schedule: ScheduledInvoice[] = []

  if (lease.depositSen > 0) {
    schedule.push({
      kind: 'deposit',
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: formatDayNumber(startDay),
      amountSen: lease.depositSen,
    })
  }

  for (let k = 0; ; k++) {
    const anchor = anchorDayNumber(start, k)
    if (anchor > endDay) break
    const nextAnchor = anchorDayNumber(start, k + 1)
    const fullEnd = nextAnchor - 1
    const isCut = fullEnd > endDay
    const periodEnd = isCut ? endDay : fullEnd
    const amountSen = isCut
      ? prorateSen(lease.monthlyRentSen, periodEnd - anchor + 1, nextAnchor - anchor)
      : lease.monthlyRentSen

    schedule.push({
      kind: 'rent',
      periodIndex: k,
      periodStart: formatDayNumber(anchor),
      periodEnd: formatDayNumber(periodEnd),
      dueDate: formatDayNumber(anchor),
      amountSen,
    })
  }

  return schedule
}

export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  if (invoice.paidSen >= invoice.amountSen) return 'paid'

  const nowMs = now.getTime()
  if (Number.isNaN(nowMs)) throw new Error('now must be a valid Date')
  const todayMalaysia = Math.floor((nowMs + MALAYSIA_OFFSET_MS) / DAY_MS)
  if (todayMalaysia > toDayNumber(parseDate(invoice.dueDate, 'dueDate'))) return 'overdue'

  if (invoice.paidSen > 0) return 'partially_paid'
  return 'unpaid'
}

// Either plain digits, or 1-3 digits followed by comma groups of exactly three digits.
// Optional decimal part of one or two digits. \d is ASCII-only without the `u` flag.
const RINGGIT_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

export function parseRinggitToSen(input: string): number {
  if (typeof input !== 'string') {
    throw new Error('Amount must be a string')
  }
  const match = RINGGIT_PATTERN.exec(input.trim())
  if (!match) {
    throw new Error(`Invalid ringgit amount: "${input}"`)
  }
  const ringgit = BigInt(match[1].replaceAll(',', ''))
  const sen = BigInt((match[2] ?? '').padEnd(2, '0'))
  const total = ringgit * BigInt(100) + sen
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Amount too large: "${input}"`)
  }
  return Number(total)
}
