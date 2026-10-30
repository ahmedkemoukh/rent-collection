# Rent Collection

Part of a rent collection module for Malaysian property management companies: leases, invoices, cash, bank transfer and online payments, and access control for managers, staff and tenants.

Stack: Next.js 16 (App Router, TypeScript strict), Supabase (Postgres, Auth, Storage, RLS), Prisma 7, shadcn/ui and Tailwind CSS.

## Run it

Requirements: Node.js 20.9 or newer, Docker running, and the Supabase CLI (through `npx`).

```bash
npx supabase start          # starts the local stack from supabase/config.toml
npx supabase db reset       # builds the database from supabase/migrations/
npm install                 # also runs `prisma generate` (postinstall)
cp .env.example .env.local  # local values; replace keys with `npx supabase status` if they differ
npm run seed                # creates the brief's data through the app's own code
npm run build && npm start  # http://localhost:3000
```

`npm run seed` must run on a freshly reset database. It stops with a message if the database is not empty.

### Seeded accounts

Every account uses the password **`RentCollection-2026!`**

| Account | Role | Organization |
|---|---|---|
| manager@northwind.test | manager | Northwind Properties |
| staff@northwind.test | staff | Northwind Properties |
| aisyah@northwind.test | tenant (Aisyah Rahman) | Northwind Properties |
| ben@northwind.test | tenant (Ben Lim) | Northwind Properties |
| probe@northwind.test | tenant (Probe Tenant) | Northwind Properties |
| manager@beta.test | manager | Beta Realty |
| chen@beta.test | tenant (Chen Wei) | Beta Realty |

### Other commands

```bash
npm test                    # unit tests: billing rules and the gateway signature
# Play the payment gateway (after a tenant clicks "Pay now"):
GATEWAY_X_SIGNATURE_KEY=test_x_signature_key node gateway-sim.mjs <bill_id> <amount_sen> [true|false]
```

To check the timezone rules, run `npm test` with `TZ=UTC`, `TZ=Asia/Kuala_Lumpur` and `TZ=America/New_York`. The tests pass under all three.

## What works

- **Billing** (`src/lib/billing.ts`): `generateSchedule`, `invoiceStatus` and `parseRinggitToSen`. They are pure and independent of the machine's timezone, and money is computed in integer sen.
- **Database** (`supabase/migrations/`):
  - tables, constraints and indexes, including a lease overlap exclusion constraint with inclusive dates;
  - RLS on every table, column-level grants, and the private `payment-slips` bucket with its policies;
  - triggers that keep payments undeletable, enforce valid status transitions (payments and gateway bills), check allocations, and make `audit_log` append-only.
- **HTTP API** (section 7): every endpoint, with 401, 403 and 404 handled. It accepts a session cookie or `Authorization: Bearer`.
- **Payments:**
  - the cap is enforced under a lease row lock, so simultaneous requests cannot exceed it together;
  - approve re-checks the remaining balance, reject and void require a reason, void removes only that payment's allocations;
  - allocation follows the brief's order;
  - an orphaned slip is deleted when recording fails.
- **Online payments:** unguessable bill ids, and a signed webhook (constant-time compare). The webhook is idempotent under simultaneous and out-of-order deliveries. `/payments/return` only reads.
- **Collections report:** months in Malaysia time, including empty months.
- **Seed:** creates exactly the brief's data through `createLease`, `recordPayment` and `approvePayment`, including a real slip file in Storage.
- **UI:**
  - login and role-based home;
  - staff and managers: dashboard (overdue count, 6-month collections), lease list, lease page (invoices, payments, signed slip links), recording payments in ringgit and Malaysia time with slip upload, and approve, reject or void with confirmation and reason;
  - tenants: their lease, invoices, payments, amount due now, Pay now, and phone update directly through supabase-js.

Design choices and their reasons are in `DECISIONS.md`. The code review of Part B is in `REVIEW.md`. AI session logs are in `ai-logs/`.

## Known issues

- **Hydration warnings with some browser extensions.** Extensions that inject attributes (for example `bis_skin_checked`) cause React hydration warnings in development. The app itself renders every date and time on the server with an explicit `timeZone`.
- **The seed runs Node with `--conditions=react-server`.** The services import `server-only`, which only loads under the server condition.
- **Voiding a payment does not reapply unapplied online credit** to reopened invoices. This is deliberate; see `DECISIONS.md` section 5.

## Skipped

- **Reading the audit log:** there is no screen or endpoint for it. Rows are written for every lease creation, recording, approval, rejection, void and webhook settlement, but managers cannot browse them yet.
- **Bonus items:**
  - the create-lease form with a live schedule preview (leases are created through `POST /api/leases` or the seed);
  - realtime updates on the tenant portal;
  - server-side search and pagination of the lease list.
- **Unit tests for allocation.** It is covered by end-to-end HTTP tests run during development, but those scripts are not in the repo.

## Next steps

- An audit log page for managers, and an "apply unapplied credit" action with its own audit row.
- The create-lease form with a live schedule preview, reusing `generateSchedule`.
- Move the end-to-end HTTP checks (concurrency, webhook, Data API and Storage access) into the repo as automated tests.
- Ship the audit log to separate storage with its own credentials.
