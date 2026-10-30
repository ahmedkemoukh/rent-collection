# Decisions

## 1. The same `paid=true` callback twice, 5 ms apart

Both requests pass the checks that run before any write, in `src/features/payments/gateway.ts`: the signature (line 68, else 401), the bill exists (76, else 404), and `paid_amount` equals the bill (84, else 422).

Then each opens a transaction and locks the lease row (line 92, `SELECT ... FOR UPDATE` in `allocation.ts:11`).

- **Request A gets the lock.** Its conditional update `status IN ('pending','failed')` changes 1 row (108). It creates the payment (113), allocates it, and writes the audit row.
- **Request B waits.** When A commits, B reads the bill again: it is now `paid`, so B's update changes 0 rows, and line 111 returns `ignored` with 200.

What guarantees a single payment:
- **Line 108**, the conditional update under the lock.
- **`UNIQUE (gateway_bill_id)`** (`schema.sql:128`) as the last defense. A violation there is treated as a repeat delivery (line 141).

## 2. RM 800 and RM 700 recorded at the same moment, RM 1,000 remaining

`recordPayment` (`src/features/payments/service.ts`) validates input, then opens a transaction. Its first statement locks the lease row (line 106, `allocation.ts:11`).

- **The first request (say RM 800) gets the lock.** It computes the cap as remaining minus pending under the lock (109-110): RM 1,000. RM 800 fits, so it inserts the payment (pending for staff) and commits.
- **The second request was blocked on the same lock.** It then recomputes the cap: RM 1,000 minus RM 800 pending, which is RM 200. RM 700 is more than that (line 111), so it returns 422. Nothing is written, and any uploaded slip is deleted.

Without the lock, both would read RM 1,000 and both be accepted. Approve, reject, void and the webhook take the same lock first (159, 205, 231; `gateway.ts:92`), so every money operation on a lease is serialized.

## 3. Every place that works out "today" or converts between dates and instants

All conversions use a fixed +08:00, which is exact because `Asia/Kuala_Lumpur` has no daylight saving time. The machine's timezone is never read.

- **`billing.ts:139`.** `invoiceStatus` computes "today" as floor((now + 8h) / day), so an invoice becomes overdue at 16:00Z of its due date.
- **`dates.ts:44`, `todayInMalaysia`.** Used for the gateway bill's amount due (`gateway.ts:35`), the dashboard's months, and the portal's amount due.
- **`dates.ts:39`.** The `datetime-local` default, in Malaysia time.
- **`dates.ts:20`, `parseInstant`.** Reads `receivedAt`; input without an offset is read as Malaysia time.
- **`gateway.ts:86`.** Reads `paid_at` with its own offset.
- **`dates.ts:4`/`8`.** Postgres `date` values go through UTC midnight, so the calendar day never shifts.
- **`dates.ts:59`/`64`.** Display and API output: `Intl` with an explicit `timeZone`, and ISO strings with `+08:00`.
- **`reports/service.ts:39-40`.** Month boundaries are built with `AT TIME ZONE 'Asia/Kuala_Lumpur'`, independent of the session's timezone.

## 4. Queries not subject to RLS, and what authorizes them instead

**Prisma** (`src/lib/db.ts:10`) connects as the table owner, so RLS does not apply. Every service receives the caller from `requireAuth()` (`auth.ts:42`), whose role comes only from `memberships` or `tenants`. Then:
- `canReadLease` (`leases/service.ts:101`) returns 404 for another organization or tenant.
- Role checks give 403 (`leases/service.ts:32`, `payments/service.ts:55`).
- Body IDs are filtered by the caller's `org_id` (`leases/service.ts:48-49`).
- The webhook is authorized by its HMAC signature.

**`SECURITY DEFINER` functions** (`rls.sql:20` onward) only read the caller's own membership or tenant row via `auth.uid()`, with `search_path = ''`. They live in `private`, which the Data API does not expose, and only `authenticated` can execute them.

**The service role** (`supabase/admin.ts:8`) only:
- deletes orphaned slips in the caller's folder when no payment references them (`payments/service.ts:67-70`);
- creates the seed's Auth users.

## 5. A void reopens invoices while the lease still has `unapplied_sen` from an online payment

Nothing is moved automatically. `voidPayment` (`src/features/payments/service.ts:226-252`) sets the payment to `voided`, then deletes only that payment's allocations (line 241). The online payment keeps its `unapplied_sen`, which was set once in `src/features/payments/allocation.ts:59`. The reopened invoices show as unpaid or overdue.

Example from our tests: after voiding a cash payment, the oldest invoice is unpaid while later ones stay paid, because the other payments keep their allocations.

Why:
- The brief says other payments' allocations do not change.
- An approved payment should not be rewritten as a side effect of voiding a different one.
- Reapplying credit is a money movement that deserves its own audited action by a manager ("apply unapplied credit"). I would add that next, rather than hide it inside void.

## 6. Two things the AI assistant got wrong, and how I noticed

**1. A rent invoice without an end date passed the CHECK.** The agent wrote `period_start is not null and period_end >= period_start`. When `period_end` is NULL, the comparison is NULL, and a CHECK treats NULL as passing, so such an invoice would have been accepted. I noticed it while comparing the migration with the brief, and sent the corrected line with `period_end is not null`. The agent then also added `period_index is not null`, for the same reason. In `ai-logs/01-cursor-agent.md`, search for "period_end is not null".

**2. The schema broke `prisma generate`.** A partial unique index (one deposit per lease) made Prisma read leases to invoices as one-to-one. Separately, the composite foreign key on `gateway_bill_id` had no matching unique key. I noticed when generation failed after `db pull`. We replaced the index with `UNIQUE NULLS NOT DISTINCT (lease_id, period_index)`. Search for "NULLS NOT DISTINCT".

## Other decisions

- **No foreign key from `user_id` columns to `auth.users`.** A cross-schema foreign key makes `prisma db pull` fail (P4002). The seed and the server are the only writers of these columns, and a deleted Auth user cannot sign in, so a leftover row grants nothing.
- **Triggers protect against application code, not against everyone.** The triggers keep `audit_log` append-only, keep `payments` undeletable and enforce valid status transitions, for every role including the owner using ordinary SQL. A superuser, or the owner running `ALTER TABLE ... DISABLE TRIGGER`, can still bypass them. A production system would also ship the audit log to separate storage with its own credentials.
- **`memberships` and `audit_log` have no Data API grants.** The browser never needs them, and the server reads them after its own role check. The brief allows granting less.
