// The database stores sen as bigint; the API returns plain numbers (the brief's `amountSen: number`).
export function senToNumber(value: bigint): number {
  const sen = Number(value)
  if (!Number.isSafeInteger(sen)) throw new Error(`Amount ${value} sen is outside the safe integer range`)
  return sen
}

// 150050 -> "RM 1,500.50", using integer arithmetic only.
export function formatRinggit(sen: number): string {
  const sign = sen < 0 ? '-' : ''
  const abs = Math.abs(sen)
  const ringgit = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}RM ${ringgit}.${cents}`
}
