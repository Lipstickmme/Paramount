-- Operational settings the desk can change without a deploy.
--
-- 0001_init.sql created site_settings with the four public contact details.
-- This widens that row into the single place the business is configured from:
-- the addresses notifications go to, whether the customer is emailed when a
-- consignment moves, and how the chat widget introduces itself.
--
-- Every column is optional. Anything left blank falls back to the environment
-- variable it shadows (FORM_TO, FORM_FROM, MAILBOX_ADDRESS...), so a fresh
-- deployment works before anyone opens the settings tab.
--
-- Safe to run more than once. Requires 0001_init.sql.

alter table public.site_settings add column if not exists company_name text;
alter table public.site_settings add column if not exists tagline text;
alter table public.site_settings add column if not exists support_phone text;
alter table public.site_settings add column if not exists whatsapp text;
alter table public.site_settings add column if not exists emergency_phone text;

-- --- Email ------------------------------------------------------------------
-- Where enquiries, quote requests and chat alerts land.
alter table public.site_settings add column if not exists notify_email text;
-- The verified sender mail leaves as, e.g. "Paramount <ops@example.com>".
alter table public.site_settings add column if not exists from_email text;
-- Reply-To stamped on customer-facing mail.
alter table public.site_settings add column if not exists reply_to text;
-- Signature appended to replies sent from the desk.
alter table public.site_settings add column if not exists email_signature text;
-- Send the customer an acknowledgement the moment a form is submitted.
alter table public.site_settings add column if not exists auto_reply boolean not null default true;
-- Email the consignee every time a shipment's status changes.
alter table public.site_settings add column if not exists notify_on_shipment_update boolean not null default true;
-- Email the shipper and consignee when a consignment is first booked.
alter table public.site_settings add column if not exists notify_on_shipment_created boolean not null default true;

-- --- Chat -------------------------------------------------------------------
alter table public.site_settings add column if not exists chat_enabled boolean not null default true;
alter table public.site_settings add column if not exists chat_greeting text;
-- Raise an email alert on every inbound chat message.
alter table public.site_settings add column if not exists chat_notify boolean not null default true;
alter table public.site_settings add column if not exists chat_agent_name text;
alter table public.site_settings add column if not exists chat_away_message text;

update public.site_settings
   set company_name = coalesce(company_name, 'Paramount Logistics')
 where id = 'default';

-- The dashboard reads this row straight from PostgREST as the signed-in admin,
-- which 0001_init.sql already allows. Nothing new is granted here.
