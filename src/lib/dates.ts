// Prisma represents Postgres `date` columns as a Date at 00:00 UTC.
// Converting through UTC keeps the calendar day unchanged whatever the server's timezone.

export function dateOnlyToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function dbToDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

const MALAYSIA_OFFSET_MS = 8 * 3_600_000

const INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/

// Parses an ISO 8601 instant. Without an offset it is read as Malaysia time (what a
// datetime-local input in the UI produces), never as the server's local time.
// Returns null for anything else, including impossible dates such as 2026-02-30.
export function parseInstant(value: string): Date | null {
  const match = INSTANT_PATTERN.exec(value.trim())
  if (!match) return null
  const [, datePart, hours, minutes, seconds = '00', offset = '+08:00'] = match
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null

  const instant = new Date(`${value.trim()}${match[5] ? '' : '+08:00'}`)
  if (Number.isNaN(instant.getTime())) return null

  const offsetMs =
    offset === 'Z'
      ? 0
      : (offset.startsWith('-') ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) * 60_000
  // Reject dates that JavaScript silently rolls over (Feb 30 -> Mar 2).
  if (new Date(instant.getTime() + offsetMs).toISOString().slice(0, 10) !== datePart) return null
  return instant
}

// The current Malaysia time as 'YYYY-MM-DDTHH:mm', the value format of an <input type="datetime-local">.
export function malaysiaDateTimeLocal(now: Date = new Date()): string {
  return new Date(now.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 16)
}

// Today's calendar date in Malaysia, as YYYY-MM-DD, whatever the server's timezone.
export function todayInMalaysia(now: Date = new Date()): string {
  return new Date(now.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 10)
}

const MALAYSIA_DATE_TIME = new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// For display: always Malaysia time, whatever the server's or the viewer's timezone.
export function formatMalaysiaDateTime(value: Date): string {
  return `${MALAYSIA_DATE_TIME.format(value)} MYT`
}

// An instant as ISO 8601 with the Malaysia offset, e.g. 2026-01-31T10:00:00.000+08:00.
export function toMalaysiaIso(value: Date): string {
  return new Date(value.getTime() + MALAYSIA_OFFSET_MS).toISOString().replace('Z', '+08:00')
}
