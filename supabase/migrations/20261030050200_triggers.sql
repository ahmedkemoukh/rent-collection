-- Integrity triggers. They stop application code (and any non-superuser role) from breaking these
-- rules with ordinary statements. They do not stop a superuser, or the table owner disabling them
-- with ALTER TABLE ... DISABLE TRIGGER; that limit is documented in DECISIONS.md.
-- Functions live in the private schema and are not executable through the Data API.

create function private.forbid_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% cannot be truncated', tg_table_name using errcode = '42501';
end
$$;

-- payments: never deleted; only valid status transitions; identity and money columns are immutable.
create function private.payments_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payments are never deleted' using errcode = '42501';
  end if;

  if new.id <> old.id
    or new.org_id <> old.org_id
    or new.lease_id <> old.lease_id
    or new.amount_sen <> old.amount_sen
    or new.method <> old.method
    or new.received_at <> old.received_at
    or new.slip_path is distinct from old.slip_path
    or new.gateway_bill_id is distinct from old.gateway_bill_id
    or new.recorded_by is distinct from old.recorded_by
    or new.created_at <> old.created_at
  then
    raise exception 'payment % has immutable columns', old.id using errcode = '42501';
  end if;

  if new.status <> old.status and not (
    (old.status = 'pending_verification' and new.status in ('approved', 'rejected'))
    or (old.status = 'approved' and new.status = 'voided')
  ) then
    raise exception 'payment % cannot go from % to %', old.id, old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end
$$;

create trigger payments_guard
  before update or delete on public.payments
  for each row execute function private.payments_guard();

create trigger payments_no_truncate
  before truncate on public.payments
  for each statement execute function private.forbid_truncate();

-- gateway_bills: pending -> paid, failed -> paid, pending -> failed. A paid bill never changes status.
create function private.gateway_bills_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id
    or new.org_id <> old.org_id
    or new.lease_id <> old.lease_id
    or new.amount_sen <> old.amount_sen
  then
    raise exception 'gateway bill % has immutable columns', old.id using errcode = '42501';
  end if;

  if new.status <> old.status and not (
    (old.status in ('pending', 'failed') and new.status = 'paid')
    or (old.status = 'pending' and new.status = 'failed')
  ) then
    raise exception 'gateway bill % cannot go from % to %', old.id, old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end
$$;

create trigger gateway_bills_guard
  before update on public.gateway_bills
  for each row execute function private.gateway_bills_guard();

-- payment_allocations: same lease, approved payment only, and the totals never exceed
-- the payment amount or the invoice amount. Concurrent writers are serialized by the
-- server's lease row lock, so these sums see every committed allocation of the lease.
create function private.payment_allocations_check() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_payment_total bigint;
  v_invoice_total bigint;
begin
  select * into v_payment from public.payments where id = new.payment_id;
  select * into v_invoice from public.invoices where id = new.invoice_id;

  if v_payment.lease_id <> v_invoice.lease_id then
    raise exception 'allocation links a payment and an invoice of different leases'
      using errcode = '23514';
  end if;

  if v_payment.status <> 'approved' then
    raise exception 'only approved payments can be allocated (payment % is %)', v_payment.id, v_payment.status
      using errcode = '23514';
  end if;

  select coalesce(sum(amount_sen), 0) into v_payment_total
    from public.payment_allocations where payment_id = new.payment_id;
  if v_payment_total > v_payment.amount_sen then
    raise exception 'allocations of payment % exceed its amount', v_payment.id using errcode = '23514';
  end if;

  select coalesce(sum(amount_sen), 0) into v_invoice_total
    from public.payment_allocations where invoice_id = new.invoice_id;
  if v_invoice_total > v_invoice.amount_sen then
    raise exception 'allocations of invoice % exceed its amount', v_invoice.id using errcode = '23514';
  end if;

  return null;
end
$$;

create trigger payment_allocations_check
  after insert or update on public.payment_allocations
  for each row execute function private.payment_allocations_check();

-- Allocations are removed only by voiding their payment (set status to voided first, then delete).
create function private.payment_allocations_delete_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.payments where id = old.payment_id and status = 'voided'
  ) then
    raise exception 'allocations can only be removed from a voided payment' using errcode = '42501';
  end if;
  return old;
end
$$;

create trigger payment_allocations_delete_guard
  before delete on public.payment_allocations
  for each row execute function private.payment_allocations_delete_guard();

create trigger payment_allocations_no_truncate
  before truncate on public.payment_allocations
  for each statement execute function private.forbid_truncate();

-- audit_log: append-only.
create function private.audit_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.forbid_truncate();

revoke update, delete, truncate on public.audit_log from public, anon, authenticated, service_role;
revoke delete, truncate on public.payments from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, service_role;
