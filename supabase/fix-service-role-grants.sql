-- EASY&EASY — reparo de permissões para o backend Supabase
-- Execute no SQL Editor caso as tabelas já tenham sido criadas.

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.licenses to service_role;
grant select, insert, update, delete on table public.payments to service_role;
grant select, insert, update, delete on table public.activations to service_role;

grant execute on function public.confirm_payment(text, timestamptz, jsonb)
  to service_role;
grant execute on function public.activate_license(text, text, text)
  to service_role;
