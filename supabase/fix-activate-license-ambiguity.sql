-- EASY&EASY — corrige a ambiguidade 42702 na função activate_license.

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

revoke all on function public.activate_license(text, text, text)
  from public, anon, authenticated;
grant execute on function public.activate_license(text, text, text)
  to service_role;
