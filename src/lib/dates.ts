// Prisma represents Postgres `date` columns as a Date at 00:00 UTC.
// Converting through UTC keeps the calendar day unchanged whatever the server's timezone.

export function dateOnlyToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function dbToDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

const MALAYSIA_OFFSET_MS = 8 * 3_600_000

// An instant as ISO 8601 with the Malaysia offset, e.g. 2026-01-31T10:00:00.000+08:00.
export function toMalaysiaIso(value: Date): string {
  return new Date(value.getTime() + MALAYSIA_OFFSET_MS).toISOString().replace('Z', '+08:00')
}
