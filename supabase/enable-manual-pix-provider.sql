-- EASY&EASY — habilita o provedor PIX manual em instalações existentes.
-- Execute uma vez no SQL Editor do Supabase antes do deploy com manual_pix.

begin;

alter table public.payments
  drop constraint if exists payments_provider_check;

alter table public.payments
  add constraint payments_provider_check
  check (provider in ('mercado_pago', 'manual_pix', 'mock'));

commit;
