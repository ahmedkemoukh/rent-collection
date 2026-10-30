'use client'

import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{5,19}$/

// Updates the tenant's own phone directly through the Data API from the browser.
// RLS and the column grant allow exactly this: the phone column of the caller's own tenant row.
export function PhoneForm({ tenantId, initialPhone }: { tenantId: string; initialPhone: string | null }) {
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = phone.trim()
    if (value !== '' && !PHONE_PATTERN.test(value)) {
      setError('Use digits, spaces, dashes or brackets, optionally starting with +, e.g. +60 12-345 6789')
      return
    }
    setError(null)
    setPending(true)
    const { data, error: updateError } = await createClient()
      .from('tenants')
      .update({ phone: value === '' ? null : value })
      .eq('id', tenantId)
      .select('phone')
    setPending(false)
    if (updateError || !data || data.length !== 1) {
      toast.error(`Could not update your phone number${updateError ? `: ${updateError.message}` : '.'}`)
      return
    }
    toast.success('Phone number updated.')
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="space-y-2">
        <Label htmlFor="phone">Phone number</Label>
        <Input id="phone" value={phone} aria-invalid={error !== null} onChange={(e) => setPhone(e.target.value)} placeholder="+60 12-345 6789" />
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  )
}
