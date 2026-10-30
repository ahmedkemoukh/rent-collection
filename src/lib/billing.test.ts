import { describe, expect, it } from 'vitest'
import { generateSchedule, invoiceStatus, parseRinggitToSen } from './billing'

describe('generateSchedule', () => {
  it("produces Aisyah's schedule exactly as in the brief", () => {
    expect(
      generateSchedule({
        startDate: '2026-01-31',
        endDate: '2026-07-15',
        monthlyRentSen: 150000,
        depositSen: 300000,
      }),
    ).toEqual([
      { kind: 'deposit', periodIndex: null, periodStart: null, periodEnd: null, dueDate: '2026-01-31', amountSen: 300000 },
      { kind: 'rent', periodIndex: 0, periodStart: '2026-01-31', periodEnd: '2026-02-27', dueDate: '2026-01-31', amountSen: 150000 },
      { kind: 'rent', periodIndex: 1, periodStart: '2026-02-28', periodEnd: '2026-03-30', dueDate: '2026-02-28', amountSen: 150000 },
      { kind: 'rent', periodIndex: 2, periodStart: '2026-03-31', periodEnd: '2026-04-29', dueDate: '2026-03-31', amountSen: 150000 },
      { kind: 'rent', periodIndex: 3, periodStart: '2026-04-30', periodEnd: '2026-05-30', dueDate: '2026-04-30', amountSen: 150000 },
      { kind: 'rent', periodIndex: 4, periodStart: '2026-05-31', periodEnd: '2026-06-29', dueDate: '2026-05-31', amountSen: 150000 },
      { kind: 'rent', periodIndex: 5, periodStart: '2026-06-30', periodEnd: '2026-07-15', dueDate: '2026-06-30', amountSen: 77419 },
    ])
  })

  it("rounds Ben's last period half up (100029 x 15 / 30 = 50014.5 -> 50015)", () => {
    const schedule = generateSchedule({
      startDate: '2026-01-01',
      endDate: '2026-04-15',
      monthlyRentSen: 100029,
      depositSen: 0,
    })
    expect(schedule.at(-1)).toEqual({
      kind: 'rent',
      periodIndex: 3,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-15',
      dueDate: '2026-04-01',
      amountSen: 50015,
    })
  })

  it('uses Feb 29 as the second anchor of a Jan 31 lease in a leap year', () => {
    const schedule = generateSchedule({
      startDate: '2028-01-31',
      endDate: '2028-04-29',
      monthlyRentSen: 100000,
      depositSen: 0,
    })
    expect(schedule.map((i) => [i.periodStart, i.periodEnd])).toEqual([
      ['2028-01-31', '2028-02-28'],
      ['2028-02-29', '2028-03-30'],
      ['2028-03-31', '2028-04-29'],
    ])
  })

  it('has no deposit invoice when depositSen is 0', () => {
    const schedule = generateSchedule({
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      monthlyRentSen: 100000,
      depositSen: 0,
    })
    expect(schedule).toHaveLength(3)
    expect(schedule.every((i) => i.kind === 'rent')).toBe(true)
    expect(schedule[0].periodIndex).toBe(0)
  })

  describe('validation', () => {
    const valid = { startDate: '2026-01-01', endDate: '2026-03-31', monthlyRentSen: 100000, depositSen: 0 }

    it.each(['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-01', '2026-01-01T00:00:00Z', ''])(
      'rejects the date %j',
      (date) => {
        expect(() => generateSchedule({ ...valid, startDate: date })).toThrow(Error)
        expect(() => generateSchedule({ ...valid, endDate: date })).toThrow(Error)
      },
    )

    it('rejects an endDate before the startDate', () => {
      expect(() => generateSchedule({ ...valid, startDate: '2026-03-02', endDate: '2026-03-01' })).toThrow(Error)
    })

    it('accepts a one-day lease (endDate equal to startDate)', () => {
      expect(generateSchedule({ ...valid, startDate: '2026-03-01', endDate: '2026-03-01' })).toHaveLength(1)
    })

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects monthlyRentSen %s', (monthlyRentSen) => {
      expect(() => generateSchedule({ ...valid, monthlyRentSen })).toThrow(Error)
    })

    it.each([-1, 0.5, Number.NaN])('rejects depositSen %s', (depositSen) => {
      expect(() => generateSchedule({ ...valid, depositSen })).toThrow(Error)
    })
  })
})

describe('invoiceStatus', () => {
  const due = (paidSen: number) => ({ dueDate: '2026-03-01', amountSen: 100000, paidSen })
  const beforeOverdue = new Date('2026-03-01T15:59:59Z')
  const overdueStarts = new Date('2026-03-01T16:00:00Z')

  it('is paid when paidSen reaches amountSen, even after the due date', () => {
    expect(invoiceStatus(due(100000), overdueStarts)).toBe('paid')
    expect(invoiceStatus(due(150000), new Date('2027-01-01T00:00:00Z'))).toBe('paid')
  })

  it('becomes overdue exactly at 2026-03-02 00:00 Malaysia time, not a second earlier', () => {
    expect(invoiceStatus(due(0), beforeOverdue)).toBe('unpaid')
    expect(invoiceStatus(due(0), new Date('2026-03-01T15:59:59.999Z'))).toBe('unpaid')
    expect(invoiceStatus(due(0), overdueStarts)).toBe('overdue')
  })

  it('is overdue rather than partially_paid once past the due date', () => {
    expect(invoiceStatus(due(1), overdueStarts)).toBe('overdue')
  })

  it('is partially_paid before the due date passes', () => {
    expect(invoiceStatus(due(1), beforeOverdue)).toBe('partially_paid')
  })

  it('is unpaid with nothing paid before the due date passes', () => {
    expect(invoiceStatus(due(0), new Date('2026-02-28T16:00:00Z'))).toBe('unpaid')
  })
})

describe('parseRinggitToSen', () => {
  it.each([
    ['1,500.50', 150050],
    ['1.15', 115],
    ['7', 700],
    ['  7  ', 700],
    ['1.5', 150],
    ['0.01', 1],
    ['1,234,567.89', 123456789],
  ])('parses %j as %i sen', (input, expected) => {
    expect(parseRinggitToSen(input)).toBe(expected)
  })

  it.each(['', '-5', '1.234', '1e3', 'RM 10', '1,23', '1.', '.5', '1,2345', '1 000', '+5'])('rejects %j', (input) => {
    expect(() => parseRinggitToSen(input)).toThrow(Error)
  })
})
