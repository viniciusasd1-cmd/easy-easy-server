alter table public.licenses
  add column if not exists user_phone text;

alter table public.licenses
  drop constraint if exists licenses_user_phone_format;

alter table public.licenses
  add constraint licenses_user_phone_format
  check (user_phone is null or user_phone ~ '^\+55[0-9]{10,11}$');

comment on column public.licenses.user_phone is
  'WhatsApp do comprador normalizado no formato E.164 brasileiro';
