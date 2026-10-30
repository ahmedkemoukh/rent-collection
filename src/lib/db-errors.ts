// Postgres SQLSTATE codes surface in different places depending on how Prisma wraps the
// driver adapter error, so search the error and its causes for the code.
export function hasPostgresCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>()
  const visit = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    const record = value as Record<string, unknown>
    if (record.code === code || record.originalCode === code) return true
    return ['cause', 'meta', 'driverAdapterError'].some((key) => visit(record[key]))
  }
  return visit(error)
}

export const PG_EXCLUSION_VIOLATION = '23P01'
export const PG_UNIQUE_VIOLATION = '23505'
