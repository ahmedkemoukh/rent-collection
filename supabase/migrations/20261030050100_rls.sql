-- Data API access (brief section 6). Order: revoke everything, grant the minimum,
-- enable RLS everywhere, then policies by org_id and user identity.
-- Prisma connects as the table owner and is not subject to any of this; the server enforces
-- authorization itself. service_role is only used for Auth admin and Storage, never for these tables.

-- 1. Revoke everything from the API roles, including future objects.
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated, service_role;

-- Helpers live in a schema PostgREST does not expose, so /rest/v1/rpc cannot reach them.
create schema private;
revoke all on schema private from public;
alter default privileges for role postgres in schema private revoke all on functions from public;

-- Roles come only from memberships and tenants.user_id, never from user_metadata.
create function private.current_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m where m.user_id = auth.uid()
$$;

create function private.current_tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.tenants t where t.user_id = auth.uid()
$$;

create function private.current_tenant_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select t.org_id from public.tenants t where t.user_id = auth.uid()
$$;

create function private.is_own_lease(p_lease_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leases l
    where l.id = p_lease_id and l.tenant_id = private.current_tenant_id()
  )
$$;

create function private.is_own_payment(p_payment_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.payments p
    where p.id = p_payment_id and private.is_own_lease(p.lease_id)
  )
$$;

revoke all on all functions in schema private from public, anon, service_role;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- 2 and 3. Grant only what the browser needs. memberships and audit_log get nothing:
-- they are read through the server after its own role check.
grant select on
  public.organizations,
  public.units,
  public.tenants,
  public.leases,
  public.invoices,
  public.payments,
  public.payment_allocations,
  public.gateway_bills
to authenticated;
grant update (phone) on public.tenants to authenticated;

-- 4. RLS on every table, including the ones without grants.
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.units enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.gateway_bills enable row level security;
alter table public.audit_log enable row level security;

-- 5. Policies. Staff and managers see their organization; tenants see the rows of their own leases.
create policy organizations_select on public.organizations for select to authenticated
  using (id = private.current_org_id() or id = private.current_tenant_org_id());

create policy units_select on public.units for select to authenticated
  using (
    org_id = private.current_org_id()
    or exists (
      select 1 from public.leases l
      where l.unit_id = units.id and l.tenant_id = private.current_tenant_id()
    )
  );

create policy tenants_select on public.tenants for select to authenticated
  using (org_id = private.current_org_id() or user_id = auth.uid());

create policy tenants_update_own_phone on public.tenants for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy leases_select on public.leases for select to authenticated
  using (org_id = private.current_org_id() or tenant_id = private.current_tenant_id());

create policy invoices_select on public.invoices for select to authenticated
  using (org_id = private.current_org_id() or private.is_own_lease(lease_id));

create policy payments_select on public.payments for select to authenticated
  using (org_id = private.current_org_id() or private.is_own_lease(lease_id));

create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using (org_id = private.current_org_id() or private.is_own_payment(payment_id));

create policy gateway_bills_select on public.gateway_bills for select to authenticated
  using (org_id = private.current_org_id() or private.is_own_lease(lease_id));
