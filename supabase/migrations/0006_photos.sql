-- Consignment photos, and customers' requests for one.
--
-- Anyone tracking a consignment can ask to see the cargo. The request lands on
-- the desk; the desk uploads a photo against the consignment, and it appears on
-- the tracking page for everyone holding the number. Whoever asked and left an
-- address is emailed.
--
-- The images live in a public Storage bucket under random names. Public means
-- a photo's address works without a session, which is what lets the tracking
-- page show it to someone who has none — the same person who can already see
-- the rest of the consignment. The addresses are only ever handed out on the
-- tracking page, so a photo is exactly as private as its tracking number.
--
-- Every write goes through the API under the service role, so the policies
-- below only open reading to the desk.
--
-- Safe to run more than once. Requires 0003_shipments.sql.

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------

create table if not exists public.shipment_photos (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  url          text not null,
  storage_path text,
  caption      text,
  content_type text,
  bytes        integer
);

create index if not exists shipment_photos_shipment_idx
  on public.shipment_photos (shipment_id, created_at desc);

alter table public.shipment_photos enable row level security;

drop policy if exists "admins read shipment photos" on public.shipment_photos;
create policy "admins read shipment photos"
  on public.shipment_photos for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

create table if not exists public.photo_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  -- Optional. Only used to say the photo is up, and never shown on the
  -- tracking page to anyone else holding the number.
  email        text,
  note         text check (note is null or char_length(note) <= 500),
  status       text not null default 'open' check (status in ('open', 'done')),
  fulfilled_at timestamptz
);

create index if not exists photo_requests_open_idx
  on public.photo_requests (shipment_id) where status = 'open';

alter table public.photo_requests enable row level security;

drop policy if exists "admins read photo requests" on public.photo_requests;
create policy "admins read photo requests"
  on public.photo_requests for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Public for reading; only the service role writes, so no storage policies
-- are needed. JPEG, PNG and WebP up to 5 MB — the API checks the bytes as
-- well, and the desk resizes before it uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'consignment-photos',
  'consignment-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
