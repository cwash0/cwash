begin;

select pg_advisory_xact_lock(hashtext('circuitwash-order-storage-v1'));

do $$
begin
  if to_regclass('public.access_orders') is not null
     and to_regclass('public.paypal_access_orders') is not null then
    raise exception 'Both access_orders and paypal_access_orders exist; refusing an ambiguous migration.';
  end if;

  if to_regclass('public.access_orders') is null
     and to_regclass('public.paypal_access_orders') is not null then
    alter table paypal_access_orders rename to access_orders;
  end if;
end $$;

alter index if exists paypal_access_orders_pkey rename to access_orders_pkey;
alter index if exists paypal_access_orders_access_code_key rename to access_orders_access_code_key;
alter index if exists paypal_access_orders_capture_id_key rename to access_orders_capture_id_key;
alter index if exists paypal_access_orders_created_idx rename to access_orders_created_idx;
alter index if exists paypal_access_orders_completed_idx rename to access_orders_completed_idx;

do $$
begin
  if to_regclass('public.access_orders') is not null then
    alter table access_orders add column if not exists payment_method text;
    alter table access_orders add column if not exists order_type text not null default 'access_code';
    alter table access_orders add column if not exists quantity integer not null default 1;
    alter table access_orders add column if not exists entitlement_access_code text;
    alter table access_orders add column if not exists entitlement_week_start date;
    alter table access_orders add column if not exists entitlement_week_end date;
    alter table access_orders add column if not exists provider_reference text;
    update access_orders
       set payment_method = 'paypal'
     where payment_method is null or btrim(payment_method) = '';
  end if;
end $$;

do $$
begin
  if to_regclass('public.access_orders') is not null then
    execute 'alter table access_orders drop constraint if exists access_orders_provider_reference_key';
    execute 'drop index if exists access_orders_provider_reference_idx';
    execute 'create unique index if not exists access_orders_provider_reference_provider_idx on access_orders(payment_method, provider_reference) where provider_reference is not null';
    execute 'create index if not exists access_orders_type_completed_idx on access_orders(order_type, completed_at desc) where status = ''COMPLETED''';
  end if;
end $$;

commit;
