-- THOP-TEST acceptance hotfix: PostgreSQL does not expose jsonb_object_length(jsonb).
-- Count object members via jsonb_object_keys while preserving the admin authorization checks.
create or replace function public.admin_update_special_prices(p_customer_id uuid, p_prices jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_product_id uuid;
  v_price numeric;
  v_count integer;
begin
  if v_uid is null or not private.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if jsonb_typeof(p_prices) <> 'object' then
    raise exception 'INVALID_PRICES';
  end if;
  select count(*) into v_count from jsonb_object_keys(p_prices);
  if v_count > 1000 then
    raise exception 'INVALID_PRICES';
  end if;

  for v_item in
    select jsonb_build_object('product_id', key, 'price', value)
    from jsonb_each(p_prices)
  loop
    if coalesce(v_item->>'product_id','') !~* '^[0-9a-f-]{36}$'
      or coalesce(v_item->>'price','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'INVALID_PRICE_ENTRY';
    end if;
    v_product_id := (v_item->>'product_id')::uuid;
    v_price := (v_item->>'price')::numeric;
    if v_price < 0 or not exists(
      select 1 from public.products where id = v_product_id and active
    ) then
      raise exception 'INVALID_PRICE_ENTRY';
    end if;
  end loop;

  delete from public.special_prices where customer_id = p_customer_id;
  for v_item in
    select jsonb_build_object('product_id', key, 'price', value)
    from jsonb_each(p_prices)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_price := (v_item->>'price')::numeric;
    insert into public.special_prices(customer_id, product_id, price, starts_at, ends_at)
    values(p_customer_id, v_product_id, v_price, now(), null);
  end loop;

  insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
  values(v_uid, 'SPECIAL_PRICES_UPDATED', 'profile', p_customer_id::text,
         jsonb_build_object('count', v_count));
  return jsonb_build_object('customer_id', p_customer_id, 'count', v_count);
end
$function$;
