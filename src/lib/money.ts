// The database stores sen as bigint; the API returns plain numbers (the brief's `amountSen: number`).
export function senToNumber(value: bigint): number {
  const sen = Number(value)
  if (!Number.isSafeInteger(sen)) throw new Error(`Amount ${value} sen is outside the safe integer range`)
  return sen
}
