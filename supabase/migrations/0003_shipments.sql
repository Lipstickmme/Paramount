-- Paramount Logistics: shipments, movement history and quote requests.
--
-- This is the heart of the product. A shipment is created at the desk, which
-- mints its tracking number; every movement is appended to shipment_events,
-- never overwritten, so the public timeline is an audit trail rather than a
-- single mutable "current position" field.
--
-- Safe to run more than once. Requires 0001_init.sql (item_status, is_admin).

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- The stages a consignment moves through. Ordered the way a customer reads
-- them, which is also the order the public progress bar fills in.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'shipment_status') then
    create type public.shipment_status as enum (
      'pending',           -- booking registered, label created
      'picked_up',         -- collected from the shipper
      'in_transit',        -- moving between facilities
      'at_facility',       -- arrived at a hub / sorting centre
      'customs',           -- held for customs clearance
      'out_for_delivery',  -- with the final-mile courier
      'delivered',         -- signed for
      'on_hold',           -- paused: payment, documents, address
      'exception',         -- delayed or damaged; needs attention
      'cancelled'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'shipment_mode') then
    create type public.shipment_mode as enum (
      'air_freight',
      'ocean_freight',
      'road_haulage',
      'rail_freight',
      'express_courier',
      'warehousing'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------------

create table if not exists public.shipments (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- What the customer types into the box on the home page. Case is folded on
  -- the way in by the API, so the unique index below is enough to stop two
  -- consignments ever sharing one.
  tracking_number    text not null,

  status             public.shipment_status not null default 'pending',
  mode               public.shipment_mode not null default 'road_haulage',
  service_level      text,                       -- Economy / Standard / Express / Charter

  -- Parties. Email addresses are optional: a desk agent may only have a name
  -- and a phone number when the booking is taken.
  shipper_name       text not null,
  shipper_company    text,
  shipper_email      text,
  shipper_phone      text,
  shipper_address    text,

  receiver_name      text not null,
  receiver_company   text,
  receiver_email     text,
  receiver_phone     text,
  receiver_address   text,

  -- Route. Coordinates drive the map on the tracking page; they are optional
  -- so a desk agent is never blocked by not knowing them.
  origin_city        text not null,
  origin_country     text,
  origin_lat         double precision,
  origin_lng         double precision,

  destination_city   text not null,
  destination_country text,
  destination_lat    double precision,
  destination_lng    double precision,

  -- Where it is right now. Denormalised from the newest event so the list at
  -- the desk and the header on the tracking page need one row, not a join.
  current_location   text,
  current_lat        double precision,
  current_lng        double precision,

  -- Cargo
  package_type       text,                       -- Pallet / Carton / Container / Crate
  pieces             integer not null default 1 check (pieces >= 0),
  weight_kg          numeric(12, 2),
  volume_cbm         numeric(12, 3),
  dimensions         text,                       -- free text: 120 x 80 x 95 cm
  contents           text,
  declared_value     numeric(14, 2),
  currency           text default 'USD',

  -- Commercial / operational
  carrier            text,                       -- operating carrier or partner
  vessel_or_flight   text,                       -- MV Aurora / PM4417
  container_no       text,
  payment_mode       text,                       -- Prepaid / Collect / Credit
  payment_status     text,                       -- Paid / Unpaid / Partial
  freight_cost       numeric(14, 2),
  incoterms          text,
  reference          text,                       -- customer's own PO / booking ref
  special_handling   text,                       -- Fragile, temperature controlled...
  instructions       text,                       -- shown to the customer
  internal_notes     text,                       -- never leaves the desk
  signed_by          text,

  -- Milestones
  picked_up_at       timestamptz,
  departed_at        timestamptz,
  estimated_delivery timestamptz,
  delivered_at       timestamptz,

  created_by         uuid references auth.users (id) on delete set null
);

-- One consignment per number, case-insensitively. The API normalises to upper
-- case before writing, but the index is the thing that guarantees it.
create unique index if not exists shipments_tracking_number_key
  on public.shipments (upper(tracking_number));

create index if not exists shipments_created_at_idx on public.shipments (created_at desc);
create index if not exists shipments_status_idx on public.shipments (status);
create index if not exists shipments_receiver_email_idx on public.shipments (lower(receiver_email));

-- Keep updated_at honest without every caller having to remember it.
create or replace function public.touch_shipment()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shipments_touch on public.shipments;
create trigger shipments_touch
  before update on public.shipments
  for each row execute function public.touch_shipment();

-- ---------------------------------------------------------------------------
-- Movement history
-- ---------------------------------------------------------------------------

-- Append-only. Editing a shipment's location writes a row here; the row is
-- what the customer sees, and the shipment's own columns are only a cache of
-- the newest one.
create table if not exists public.shipment_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  status      public.shipment_status not null,
  location    text,
  lat         double precision,
  lng         double precision,
  note        text,
  -- Hidden from the public timeline; for the desk's own record keeping.
  internal    boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null
);

create index if not exists shipment_events_shipment_idx
  on public.shipment_events (shipment_id, occurred_at desc);

-- Roll the newest public event up onto the shipment, so a tracking lookup is
-- a single row read and the desk list shows live positions.
create or replace function public.apply_shipment_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  newest timestamptz;
begin
  if new.internal then
    return new;
  end if;

  select max(occurred_at) into newest
    from public.shipment_events
   where shipment_id = new.shipment_id and internal = false;

  -- Back-dated corrections must not drag the shipment backwards.
  if newest is null or new.occurred_at >= newest then
    update public.shipments
       set status           = new.status,
           current_location = coalesce(new.location, current_location),
           current_lat      = coalesce(new.lat, current_lat),
           current_lng      = coalesce(new.lng, current_lng),
           picked_up_at     = case when new.status = 'picked_up'
                                   then coalesce(picked_up_at, new.occurred_at) else picked_up_at end,
           delivered_at     = case when new.status = 'delivered'
                                   then new.occurred_at else delivered_at end,
           updated_at       = now()
     where id = new.shipment_id;
  end if;

  return new;
end;
$$;

drop trigger if exists shipment_events_apply on public.shipment_events;
create trigger shipment_events_apply
  after insert on public.shipment_events
  for each row execute function public.apply_shipment_event();

-- ---------------------------------------------------------------------------
-- Quote requests
-- ---------------------------------------------------------------------------

create table if not exists public.quote_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null,
  email         text not null,
  phone         text,
  company       text,
  mode          text,                -- matches shipment_mode, kept loose for the form
  origin        text,
  destination   text,
  cargo_type    text,
  weight_kg     numeric(12, 2),
  dimensions    text,
  pieces        integer,
  ready_date    date,
  incoterms     text,
  message       text,
  ip            text,
  status        public.item_status not null default 'new',
  notes         text
);

create index if not exists quote_requests_created_at_idx
  on public.quote_requests (created_at desc);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.quote_requests enable row level security;

-- Public tracking does NOT read these tables directly. It goes through
-- GET /api/track/:number, which holds the service role and returns exactly the
-- fields a customer may see. A blanket select policy here would let anyone
-- page through every consignment in the business, so there is none: only
-- signed-in staff can read the tables, and everyone else goes through the
-- function below, which requires knowing the whole tracking number.
drop policy if exists "admins read shipments" on public.shipments;
create policy "admins read shipments"
  on public.shipments for select to authenticated using (public.is_admin());

drop policy if exists "admins write shipments" on public.shipments;
create policy "admins write shipments"
  on public.shipments for insert to authenticated with check (public.is_admin());

drop policy if exists "admins update shipments" on public.shipments;
create policy "admins update shipments"
  on public.shipments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete shipments" on public.shipments;
create policy "admins delete shipments"
  on public.shipments for delete to authenticated using (public.is_admin());

drop policy if exists "admins read shipment events" on public.shipment_events;
create policy "admins read shipment events"
  on public.shipment_events for select to authenticated using (public.is_admin());

drop policy if exists "admins write shipment events" on public.shipment_events;
create policy "admins write shipment events"
  on public.shipment_events for insert to authenticated with check (public.is_admin());

drop policy if exists "admins update shipment events" on public.shipment_events;
create policy "admins update shipment events"
  on public.shipment_events for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete shipment events" on public.shipment_events;
create policy "admins delete shipment events"
  on public.shipment_events for delete to authenticated using (public.is_admin());

drop policy if exists "admins read quotes" on public.quote_requests;
create policy "admins read quotes"
  on public.quote_requests for select to authenticated using (public.is_admin());

drop policy if exists "admins update quotes" on public.quote_requests;
create policy "admins update quotes"
  on public.quote_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Public tracking function
-- ---------------------------------------------------------------------------

-- The one way an unauthenticated visitor (or the anonymous session the chat
-- widget signs in with) can reach a consignment: by quoting its whole tracking
-- number. SECURITY DEFINER so it can read past the policies above, and it
-- returns only the customer-facing columns -- no internal notes, no costs, no
-- shipper contact details.
create or replace function public.track_shipment(p_tracking_number text)
returns table (
  tracking_number    text,
  status             public.shipment_status,
  mode               public.shipment_mode,
  service_level      text,
  shipper_name       text,
  receiver_name      text,
  origin_city        text,
  origin_country     text,
  destination_city   text,
  destination_country text,
  current_location   text,
  current_lat        double precision,
  current_lng        double precision,
  package_type       text,
  pieces             integer,
  weight_kg          numeric,
  dimensions         text,
  contents           text,
  carrier            text,
  vessel_or_flight   text,
  reference          text,
  special_handling   text,
  instructions       text,
  signed_by          text,
  picked_up_at       timestamptz,
  departed_at        timestamptz,
  estimated_delivery timestamptz,
  delivered_at       timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz,
  events             jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select s.tracking_number, s.status, s.mode, s.service_level,
         s.shipper_name, s.receiver_name,
         s.origin_city, s.origin_country, s.destination_city, s.destination_country,
         s.current_location, s.current_lat, s.current_lng,
         s.package_type, s.pieces, s.weight_kg, s.dimensions, s.contents,
         s.carrier, s.vessel_or_flight, s.reference, s.special_handling,
         s.instructions, s.signed_by,
         s.picked_up_at, s.departed_at, s.estimated_delivery, s.delivered_at,
         s.created_at, s.updated_at,
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'occurred_at', e.occurred_at,
                     'status', e.status,
                     'location', e.location,
                     'lat', e.lat,
                     'lng', e.lng,
                     'note', e.note
                   ) order by e.occurred_at desc)
              from public.shipment_events e
             where e.shipment_id = s.id and e.internal = false),
           '[]'::jsonb
         ) as events
    from public.shipments s
   where upper(s.tracking_number) = upper(btrim(p_tracking_number))
   limit 1;
$$;

revoke all on function public.track_shipment(text) from public;
grant execute on function public.track_shipment(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'shipments'
  ) then
    alter publication supabase_realtime add table public.shipments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'shipment_events'
  ) then
    alter publication supabase_realtime add table public.shipment_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'quote_requests'
  ) then
    alter publication supabase_realtime add table public.quote_requests;
  end if;
end
$$;
