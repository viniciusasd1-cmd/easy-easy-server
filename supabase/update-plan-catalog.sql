begin;

alter table public.licenses
  drop constraint if exists licenses_plan_check;

alter table public.licenses
  add constraint licenses_plan_check
  check (plan in ('daily', 'weekly', 'fortnightly', 'monthly', 'annual', 'lifetime'));

create or replace function public.confirm_payment(
  p_provider_payment_id text,
  p_paid_at timestamptz,
  p_raw_response jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_license public.licenses%rowtype;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
  v_expires_at timestamptz;
begin
  select * into v_payment
    from public.payments
   where payment_id = p_provider_payment_id
   for update;

  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  select * into v_license
    from public.licenses
   where id = v_payment.license_id
   for update;

  if v_payment.status = 'paid' then
    return v_payment.license_id;
  end if;

  v_expires_at := case v_license.plan
    when 'daily' then v_paid_at + interval '1 day'
    when 'weekly' then v_paid_at + interval '7 days'
    when 'fortnightly' then v_paid_at + interval '15 days'
    when 'monthly' then v_paid_at + interval '30 days'
    when 'annual' then v_paid_at + interval '365 days'
    when 'lifetime' then null
  end;

  update public.payments
     set status = 'paid',
         paid_at = v_paid_at,
         raw_response = coalesce(p_raw_response, '{}'::jsonb)
   where id = v_payment.id;

  update public.licenses
     set payment_status = 'paid',
         payment_id = p_provider_payment_id,
         expires_at = v_expires_at,
         is_active = true
   where id = v_payment.license_id;

  return v_payment.license_id;
end;
$$;

revoke all on function public.confirm_payment(text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.confirm_payment(text, timestamptz, jsonb)
  to service_role;

commit;
