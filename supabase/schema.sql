-- EASY&EASY — banco de licenças e pagamentos
-- Execute no SQL Editor do Supabase antes de iniciar o servidor.

create extension if not exists pgcrypto;

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_key text unique not null,
  plan text not null,
  user_email text,
  user_phone text,
  user_name text,
  device_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_validated_at timestamptz,
  is_active boolean not null default true,
  max_devices integer not null default 1,
  activated_devices text[] not null default '{}',
  payment_id text,
  payment_status text not null default 'pending',
  constraint licenses_key_format_check
    check (license_key ~ '^EASY-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$'),
  constraint licenses_plan_check
    check (plan in ('daily', 'weekly', 'fortnightly', 'monthly', 'annual', 'lifetime')),
  constraint licenses_user_phone_format
    check (user_phone is null or user_phone ~ '^\+55[0-9]{10,11}$'),
  constraint licenses_payment_status_check
    check (payment_status in ('pending', 'paid', 'expired', 'failed', 'refunded')),
  constraint licenses_max_devices_check
    check (max_devices between 1 and 10)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  amount numeric(10, 2) not null,
  method text not null default 'PIX',
  provider text not null default 'mercado_pago',
  payment_id text unique not null,
  qr_code text,
  qr_code_base64 text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  paid_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  constraint payments_amount_check check (amount > 0),
  constraint payments_method_check check (method = 'PIX'),
  constraint payments_provider_check
    check (provider in ('mercado_pago', 'manual_pix', 'mock')),
  constraint payments_status_check
    check (status in ('pending', 'paid', 'expired', 'failed', 'refunded'))
);

create table if not exists public.activations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  device_id text not null,
  user_agent text,
  activated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  is_active boolean not null default true,
  constraint activations_device_id_check check (length(device_id) between 8 and 128),
  constraint activations_license_device_unique unique (license_id, device_id)
);

create index if not exists payments_license_id_idx
  on public.payments (license_id);
create index if not exists activations_license_id_idx
  on public.activations (license_id);
create index if not exists activations_device_id_idx
  on public.activations (device_id);
create index if not exists payments_pending_created_at_idx
  on public.payments (created_at)
  where status = 'pending';
create index if not exists licenses_active_validation_idx
  on public.licenses (last_validated_at)
  where is_active = true and payment_status = 'paid';

alter table public.licenses enable row level security;
alter table public.payments enable row level security;
alter table public.activations enable row level security;
alter table public.licenses force row level security;
alter table public.payments force row level security;
alter table public.activations force row level security;

-- Nenhuma tabela de licenciamento é acessível diretamente pela extensão.
revoke all on table public.licenses from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.activations from anon, authenticated;

-- Supabase passou a exigir grants explícitos para a Data API em projetos novos.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.licenses to service_role;
grant select, insert, update, delete on table public.payments to service_role;
grant select, insert, update, delete on table public.activations to service_role;

-- Chaves secretas modernas do backend assumem o papel service_role. Estes
-- grants devem ser reaplicados ao atualizar uma instalação criada antes da
-- mudança de privilégios explícitos da Data API.
grant execute on all functions in schema public to service_role;

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
  select *
    into v_payment
    from public.payments
   where payment_id = p_provider_payment_id
   for update;

  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  select *
    into v_license
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

create or replace function public.activate_license(
  p_license_key text,
  p_device_id text,
  p_user_agent text default null
)
returns table (
  success boolean,
  error_code text,
  message text,
  license_id uuid,
  user_name text,
  plan text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license public.licenses%rowtype;
  v_active_devices integer;
begin
  if p_device_id is null or length(trim(p_device_id)) < 8 then
    return query select false, 'invalid_device', 'Dispositivo inválido', null::uuid,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  select *
    into v_license
    from public.licenses
   where license_key = upper(trim(p_license_key))
   for update;

  if not found then
    return query select false, 'invalid_key', 'Chave inválida', null::uuid,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_license.payment_status <> 'paid' then
    return query select false, 'payment_pending', 'Aguardando confirmação do pagamento',
      v_license.id, v_license.user_name, v_license.plan, v_license.expires_at;
    return;
  end if;

  if not v_license.is_active then
    return query select false, 'inactive_license', 'Licença desativada',
      v_license.id, v_license.user_name, v_license.plan, v_license.expires_at;
    return;
  end if;

  if v_license.expires_at is not null and v_license.expires_at <= now() then
    return query select false, 'expired_license', 'Licença expirada',
      v_license.id, v_license.user_name, v_license.plan, v_license.expires_at;
    return;
  end if;

  if not exists (
    select 1
      from public.activations
     where activations.license_id = v_license.id
       and activations.device_id = trim(p_device_id)
       and activations.is_active = true
  ) then
    select count(*)
      into v_active_devices
      from public.activations
     where activations.license_id = v_license.id
       and activations.is_active = true;

    if v_active_devices >= v_license.max_devices then
      return query select false, 'device_limit', 'Limite de dispositivos atingido',
        v_license.id, v_license.user_name, v_license.plan, v_license.expires_at;
      return;
    end if;
  end if;

  insert into public.activations (
    license_id,
    device_id,
    user_agent,
    activated_at,
    last_used_at,
    is_active
  ) values (
    v_license.id,
    trim(p_device_id),
    p_user_agent,
    now(),
    now(),
    true
  )
  on conflict on constraint activations_license_device_unique do update
    set user_agent = excluded.user_agent,
        last_used_at = now(),
        is_active = true;

  update public.licenses
     set device_id = coalesce(device_id, trim(p_device_id)),
         activated_devices = case
           when trim(p_device_id) = any(activated_devices) then activated_devices
           else array_append(activated_devices, trim(p_device_id))
         end,
         last_validated_at = now()
   where id = v_license.id;

  return query select true, null::text, 'Licença ativada com sucesso!',
    v_license.id, coalesce(v_license.user_name, 'Usuário'), v_license.plan,
    v_license.expires_at;
end;
$$;

revoke all on function public.confirm_payment(text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.activate_license(text, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_payment(text, timestamptz, jsonb)
  to service_role;
grant execute on function public.activate_license(text, text, text)
  to service_role;

comment on table public.licenses is 'Licenças EASY&EASY; acesso exclusivo pelo backend.';
comment on table public.payments is 'Pagamentos PIX e dados de reconciliação do provedor.';
comment on table public.activations is 'Dispositivos ativados por licença.';
