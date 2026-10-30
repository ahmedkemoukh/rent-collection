import Link from 'next/link'
import { requirePageAuth } from '@/lib/session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatRinggit } from '@/lib/money'
import { createClient } from '@/lib/supabase/server'

interface LeaseRow {
  id: string
  start_date: string
  end_date: string
  monthly_rent_sen: number
  units: { name: string } | null
  tenants: { full_name: string } | null
}

// Read through the Data API with the user's session: RLS limits rows to the caller's organization.
export default async function LeasesPage() {
  // Layouts and pages render in parallel, so the page checks the caller itself.
  await requirePageAuth('staff')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('leases')
    .select('id, start_date, end_date, monthly_rent_sen, units(name), tenants(full_name)')
    .order('start_date', { ascending: true })
    .returns<LeaseRow[]>()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leases</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">Could not load leases: {error.message}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leases yet in your organization.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead className="text-right">Monthly rent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((lease) => (
                <TableRow key={lease.id}>
                  <TableCell>
                    <Link href={`/leases/${lease.id}`} className="font-medium underline-offset-4 hover:underline">
                      {lease.units?.name ?? 'Unit'}
                    </Link>
                  </TableCell>
                  <TableCell>{lease.tenants?.full_name}</TableCell>
                  <TableCell>{lease.start_date}</TableCell>
                  <TableCell>{lease.end_date}</TableCell>
                  <TableCell className="text-right">{formatRinggit(lease.monthly_rent_sen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
