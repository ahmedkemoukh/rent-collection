import './load-env'
import { createLease } from '@/features/leases/service'
import { approvePayment, recordPayment, SLIP_BUCKET } from '@/features/payments/service'
import type { AuthContext, StaffRole } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createAdminClient } from '@/lib/supabase/admin'

// Shared by every seeded account; submitted with the work.
const SEED_PASSWORD = 'RentCollection-2026!'

const admin = createAdminClient()

async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`)
  return data.user.id
}

async function createStaff(orgId: string, email: string, role: StaffRole): Promise<AuthContext> {
  const userId = await createAuthUser(email)
  await prisma.memberships.create({ data: { user_id: userId, org_id: orgId, role } })
  return { userId, role, orgId, tenantId: null }
}

async function createTenant(orgId: string, email: string, fullName: string): Promise<string> {
  const userId = await createAuthUser(email)
  const tenant = await prisma.tenants.create({ data: { org_id: orgId, user_id: userId, full_name: fullName, email } })
  return tenant.id
}

async function createUnit(orgId: string, name: string): Promise<string> {
  return (await prisma.units.create({ data: { org_id: orgId, name } })).id
}

async function main() {
  if ((await prisma.organizations.count()) > 0) {
    throw new Error('The database is not empty. Run `npx supabase db reset` first.')
  }

  // Organizations, accounts, units: plain setup data (the app has no endpoint for these).
  const northwind = await prisma.organizations.create({ data: { name: 'Northwind Properties' } })
  const beta = await prisma.organizations.create({ data: { name: 'Beta Realty' } })

  const northwindManager = await createStaff(northwind.id, 'manager@northwind.test', 'manager')
  const northwindStaff = await createStaff(northwind.id, 'staff@northwind.test', 'staff')
  const aisyah = await createTenant(northwind.id, 'aisyah@northwind.test', 'Aisyah Rahman')
  const ben = await createTenant(northwind.id, 'ben@northwind.test', 'Ben Lim')
  const probe = await createTenant(northwind.id, 'probe@northwind.test', 'Probe Tenant')
  const betaManager = await createStaff(beta.id, 'manager@beta.test', 'manager')
  const chen = await createTenant(beta.id, 'chen@beta.test', 'Chen Wei')

  const unitA = await createUnit(northwind.id, 'A-12-3')
  const unitB = await createUnit(northwind.id, 'B-05-1')
  const unitC = await createUnit(northwind.id, 'C-01-7')
  await createUnit(northwind.id, 'D-03-2') // no lease
  const unitKL = await createUnit(beta.id, 'KL-1')

  // Leases through the app's own lease creation (schedule, invoices and audit row).
  const aisyahLease = await createLease(northwindManager, {
    unitId: unitA, tenantId: aisyah, startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000,
  })
  await createLease(northwindManager, {
    unitId: unitB, tenantId: ben, startDate: '2026-01-01', endDate: '2026-04-15', monthlyRentSen: 100029, depositSen: 0,
  })
  await createLease(northwindManager, {
    unitId: unitC, tenantId: probe, startDate: '2026-02-28', endDate: '2027-02-27', monthlyRentSen: 200000, depositSen: 400000,
  })
  await createLease(betaManager, {
    unitId: unitKL, tenantId: chen, startDate: '2026-03-15', endDate: '2027-03-14', monthlyRentSen: 220000, depositSen: 440000,
  })

  // Aisyah's payments through the app's own payment logic (cap, allocation, approval, audit).
  await recordPayment(northwindManager, aisyahLease.id, {
    amountSen: 300000, method: 'cash', receivedAt: '2026-01-31T10:00:00+08:00',
  })

  const slipPath = `${northwind.id}/seed-aisyah-2026-03-01.pdf`
  const slip = new TextEncoder().encode('%PDF-1.4\n% Seed bank transfer slip for Aisyah Rahman, RM 2,000.00\n%%EOF\n')
  const upload = await admin.storage.from(SLIP_BUCKET).upload(slipPath, slip, { contentType: 'application/pdf' })
  if (upload.error) throw new Error(`Could not upload the slip: ${upload.error.message}`)

  const transfer = await recordPayment(northwindStaff, aisyahLease.id, {
    amountSen: 200000, method: 'bank_transfer', receivedAt: '2026-03-01T00:30:00+08:00', slipPath,
  })
  await approvePayment(northwindManager, transfer.id)

  console.log('Seed complete. All accounts use the password:', SEED_PASSWORD)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
