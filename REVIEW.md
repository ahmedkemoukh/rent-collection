# Code review: late fees, gateway webhook, collections action

Ordered from most to least severe. Line numbers refer to the pull request as given in the brief.

## Critical

### 1. Lines 98-111: `getCollections` is a public, unauthenticated endpoint that trusts `orgId`
**What goes wrong.** Every export of a `'use server'` file is a Server Action that any browser can call with any arguments. There is no `getUser()` and no role check, and `orgId` comes from the caller. A tenant, or an anonymous visitor who knows a Server Action id, calls `getCollections('<Beta org id>', '2026-01-01', '2026-12-01')` and reads another company's revenue. Prisma connects as the owner, so RLS does not stop it.
**Fix.** Authenticate inside the action (`getUser()`), load the membership, require `staff` or `manager`, and take `orgId` from the membership, never from the arguments.

### 2. Line 13: the role comes from `user_metadata`
**What goes wrong.** Users can edit their own `user_metadata` (`supabase.auth.updateUser({ data: { role: 'manager' } })`). Any tenant can then call this endpoint as a "manager" and add late fees.
**Fix.** Read the role from the `memberships` table (`user_id` -> `role`, `org_id`).

### 3. Lines 18-22: no organization check on the lease, and Prisma bypasses RLS
**What goes wrong.** `findUnique({ where: { id: leaseId } })` returns any organization's lease. A Beta Realty manager posts to `/api/leases/<Northwind lease>/late-fees` and charges Northwind's tenant. Combined with issue 2, any signed-in user can do it.
**Fix.** `findFirst({ where: { id: leaseId, orgId: membership.orgId } })`, and return 404 when it is not found (do not reveal it exists).

## High

### 4. Line 87: `paid_amount` is never compared with the bill
**What goes wrong.** A callback for a RM 2,100.50 bill with `paid_amount=1` marks the bill paid and records a 1-sen payment. The invoices stay unpaid but the bill can never be paid again. A non-numeric value makes `BigInt()` throw, giving a 500 and gateway retries.
**Fix.** Before any write, require `paid_amount` to be digits and equal to `bill.amountSen`, otherwise return 422. Record `bill.amountSen`.

### 5. Lines 75-93: the bill is read outside the transaction, with no lock and no conditional update
**What goes wrong.** The gateway delivers the same callback twice at once. Both requests read `status = 'pending'` (line 77), and both run the transaction. Line 80 updates unconditionally. Without a unique `gateway_bill_id`, two payments are created and allocated (the tenant is credited twice). With a unique constraint, the second request fails with a 500 and the gateway keeps retrying.
**Fix.** Inside the transaction, lock the lease (`SELECT ... FOR UPDATE`) and update with a condition, `UPDATE gateway_bills SET status = 'paid' WHERE id = $1 AND status <> 'paid'`. Create the payment only if one row changed, and keep `UNIQUE (payments.gateway_bill_id)` as the last line of defense.

### 6. Line 70: forged callbacks are logged together with their valid signature
**What goes wrong.** `expected` is the correct HMAC for exactly the fields the caller sent. An attacker posts `id=<bill>&paid=true&paid_amount=...` with a wrong signature, and the log now contains the valid signature for those fields. Anyone with log access can replay it and settle the bill. It also writes whole payloads to logs, which the brief forbids.
**Fix.** Log only `"invalid signature"`, without fields, `expected` or the key.

### 7. Lines 104 and 107: months and boundaries are computed in UTC, not Malaysia time
**What goes wrong.** `date_trunc('month', received_at)` and `${from}::date` use the session timezone (UTC on the server). Aisyah's transfer received 2026-03-01 00:30 MYT is 2026-02-28 16:30 UTC, so it is reported in February: the brief's expected `[300000, 0, 200000]` becomes `[300000, 200000, 0]`. Range boundaries are also 8 hours off.
**Fix.** Build month boundaries in `Asia/Kuala_Lumpur`: `received_at >= (month_start AT TIME ZONE 'Asia/Kuala_Lumpur')`, and group by the Malaysia month.

### 8. Lines 34-46 and 50-53: duplicate fees, duplicate or broken references, and partial writes
**What goes wrong.**
- **One request:** `prisma.invoice.create()` (line 34) is lazy and only runs inside `Promise.all` at line 46. But `await nextReference()` (line 41) runs for every invoice first, while no fee exists yet. With three overdue invoices, all three get the same `INV-n`.
- **Two requests at once:** both read the same "last" invoice, so the references collide again.
- **The "last" invoice is unreliable:** `orderBy: createdAt` is not the highest reference. The newest invoice is usually a rent invoice from the latest lease, which has no reference, so `last.reference.slice(4)` throws and the endpoint returns 500. An empty reference gives `INV-NaN`.
- **Calling the endpoint twice** charges a second 2% fee on the same invoice, because nothing records that a fee was already added.
- **`Promise.all` outside a transaction:** if one insert fails, the others stay. The response also says `created: n` even though nothing confirms it.

**Fix.**
- One `prisma.$transaction` with the lease locked.
- References from a database sequence.
- A unique key per (invoice, late fee) so a repeat call creates nothing.

## Medium

### 9. Line 73: `paid=false` is ignored, and before the bill lookup
**What goes wrong.** A failed payment leaves the bill `pending` forever (the brief requires `failed`). Because the check runs before line 75, a callback for an unknown bill with `paid=false` gets 200 instead of 404.
**Fix.** Look up the bill first (404). For `paid=false`, `UPDATE ... SET status = 'failed' WHERE status = 'pending'`. A paid bill never goes back.

### 10. Line 88: `receivedAt` is the time of the callback, not `paid_at`
**What goes wrong.** A payment made 2026-01-31 23:59 MYT whose callback is retried at 00:05 on 1 Feb is recorded in February, which moves money between months in the collections report.
**Fix.** Parse `paid_at` (`2026-04-01 00:30:12 +0800`) and use it as `receivedAt`. Reject an invalid `paid_at` when `paid=true`.

### 11. Line 108: months with nothing collected are missing
**What goes wrong.** `GROUP BY` only returns months that have payments. For 2026-01 to 2026-03 the result has no `2026-02` entry, while the contract requires one entry per month with `collectedSen: 0`.
**Fix.** `generate_series` over the months, with a `LEFT JOIN` on payments and `COALESCE(SUM(...), 0)`.

### 12. Line 38: `kind: 'late_fee'` is not a valid invoice kind
**What goes wrong.** Invoices are `'deposit' | 'rent'` (the `InvoiceKind` contract and the `invoice_kind` enum), so every insert fails and the endpoint always returns 500. If the column did accept it, allocation order ("deposit before rent") and `generateSchedule`'s "exactly these invoices" rule would no longer describe the lease.
**Fix.** Add the kind deliberately: extend the enum, define its allocation order, update `InvoiceKind`, or store fees in a separate table.

### 13. Line 31: a 99.5% threshold computed with floats
**What goes wrong.** An RM 1,000.00 invoice with RM 995.00 paid is skipped (995 / 1000 = 0.995), so RM 5 stays overdue without a fee. `invoiceStatus` calls it `overdue`, while this endpoint treats it as paid. Floating-point ratios on money are also fragile.
**Fix.** Compare integers: `if (paid >= invoice.amountSen) continue`.

## Low

### 14. Line 69: the signature is compared with `!==`
**What goes wrong.** String comparison stops at the first differing character, so response timing leaks how many leading characters of a guess are correct. This is hard to exploit over a network, but it is the standard mistake for HMAC checks.
**Fix.** Check the format (64 lowercase hex characters), then `crypto.timingSafeEqual` on the decoded buffers.

### 15. Lines 12-15: no session gives 403 instead of 401
**What goes wrong.** With no session, `user` is null, so line 13 returns 403 "Forbidden". The API contract says a request without a valid login gets 401. Clients cannot tell "sign in" from "not allowed".
**Fix.** `if (!user) return 401`, then the role check (403).

## Looks wrong, but is correct

### Lines 24-25: "today" computed as UTC plus 8 hours
`new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)` gives today's Malaysia date: `Asia/Kuala_Lumpur` is always UTC+8, with no daylight saving time, so a fixed offset is exact. `Date.parse('YYYY-MM-DD')` reads a date-only string as UTC midnight, and Prisma returns `@db.Date` values as UTC midnight too. So `cutoff` and `invoice.dueDate` are compared on the same basis, and "due more than 7 days ago" is computed correctly whatever the server's timezone.
