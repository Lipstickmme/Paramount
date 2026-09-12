-- Customer portal: an account that shows someone every consignment of theirs.
--
-- A customer is linked to a consignment two ways, and the difference matters:
--
--   1. By claim. The customer enters a tracking number and the consignment is
--      added to their account. This is always safe: holding the number is
--      already what public tracking treats as proof, so a claim grants nothing
--      that /track did not.
--
--   2. By email. Consignments whose shipper or consignee address matches the
--      account's own address appear automatically, with no claiming.
--
-- The second is the convenient one and the dangerous one. It is only sound if
-- the address on the account is proved to belong to the person signed in, so
-- the server refuses to match on an unconfirmed address.
--
--   >>> Turn ON "Confirm email" under Authentication, Providers, Email in
--   >>> Supabase. With it off, every sign-up is auto-confirmed, and anyone
--   >>> could register a customer's address and read that customer's
--   >>> consignments. The portal still works with confirmations off — but only
--   >>> claiming does, which is the behaviour you want in that case anyway.
--
-- Safe to run more than once. Requires 0003_shipments.sql.

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------

create table if not exists public.shipment_claims (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  -- What the customer calls it. Optional, and theirs alone: the desk never
  -- sees it and it does not touch the consignment.
  label       text
);

-- One claim per consignment per account. Claiming twice is a no-op, not a
-- second row, so the portal can insert without checking first.
create unique index if not exists shipment_claims_unique
  on public.shipment_claims (user_id, shipment_id);

create index if not exists shipment_claims_user_idx
  on public.shipment_claims (user_id, created_at desc);

alter table public.shipment_claims enable row level security;

-- A customer sees and manages their own claims and nobody else's. Claims are
-- written through POST /api/portal/claims, which resolves the tracking number
-- under the service role and so needs no insert policy here; these policies
-- are what let the browser read and delete its own.
drop policy if exists "customers read own claims" on public.shipment_claims;
create policy "customers read own claims"
  on public.shipment_claims for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "customers drop own claims" on public.shipment_claims;
create policy "customers drop own claims"
  on public.shipment_claims for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Portal settings
-- ---------------------------------------------------------------------------

-- Whether a confirmed address links consignments automatically, and whether
-- the portal is offered at all. Both live beside the other settings the desk
-- edits, so turning the portal off does not need a deploy.
alter table public.site_settings
  add column if not exists portal_enabled boolean not null default true;
alter table public.site_settings
  add column if not exists portal_email_matching boolean not null default true;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'shipment_claims'
  ) then
    alter publication supabase_realtime add table public.shipment_claims;
  end if;
end
$$;
