-- Execute after supabase-saas-fundacao.sql and before deploying the hosted Asaas checkout.
-- Safe to run repeatedly.

alter table public.saas_subscriptions
  add column if not exists asaas_checkout_id text,
  add column if not exists asaas_checkout_url text;

create table if not exists public.saas_checkout_webhook_events (
  event_id text primary key,
  checkout_id text not null,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table public.saas_checkout_webhook_events enable row level security;
revoke all on table public.saas_checkout_webhook_events from anon, authenticated;
grant all on table public.saas_checkout_webhook_events to service_role;

create or replace function public.process_saas_billing_webhook(
  p_event_id text,
  p_subscription_id text,
  p_event_type text,
  p_customer_id text,
  p_external_reference uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  if p_event_type not in ('PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_DELETED')
    or p_subscription_id is null then
    return 'ignored';
  end if;

  select s.user_id into v_user_id
  from public.saas_subscriptions s
  where s.asaas_subscription_id = p_subscription_id
     or (
       p_event_type = 'SUBSCRIPTION_CREATED'
       and s.asaas_checkout_id is not null
       and s.status in ('incomplete', 'active')
       and (
         (p_external_reference is not null and s.user_id = p_external_reference)
         or (p_customer_id is not null and s.asaas_customer_id = p_customer_id)
       )
     )
  order by case when s.asaas_subscription_id = p_subscription_id then 0 else 1 end
  limit 1
  for update;

  if not found then return 'unlinked'; end if;

  insert into public.saas_webhook_events (event_id, subscription_id, event_type)
  values (p_event_id, p_subscription_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;

  if p_event_type = 'SUBSCRIPTION_CREATED' then
    update public.saas_subscriptions
    set asaas_subscription_id = p_subscription_id, updated_at = now()
    where user_id = v_user_id;
  elsif p_event_type = 'PAYMENT_RECEIVED' then
    update public.saas_subscriptions
    set asaas_subscription_id = p_subscription_id, status = 'active', trial_ends_at = null,
        period_ends_at = now() + interval '31 days', asaas_checkout_url = null, updated_at = now()
    where user_id = v_user_id;
  elsif p_event_type = 'PAYMENT_OVERDUE' then
    update public.saas_subscriptions
    set asaas_subscription_id = p_subscription_id, status = 'past_due', updated_at = now()
    where user_id = v_user_id;
  elsif p_event_type = 'SUBSCRIPTION_DELETED' then
    update public.saas_subscriptions
    set status = 'canceled', asaas_checkout_url = null, updated_at = now()
    where user_id = v_user_id;
  end if;

  return 'updated';
end;
$$;
revoke all on function public.process_saas_billing_webhook(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.process_saas_billing_webhook(text, text, text, text, uuid) to service_role;

create or replace function public.process_saas_checkout_webhook(
  p_event_id text,
  p_checkout_id text,
  p_event_type text,
  p_customer_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  if p_event_type not in ('CHECKOUT_PAID', 'CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED')
    or p_checkout_id is null then
    return 'ignored';
  end if;

  select s.user_id into v_user_id
  from public.saas_subscriptions s
  where s.asaas_checkout_id = p_checkout_id
  for update;
  if not found then return 'unlinked'; end if;

  insert into public.saas_checkout_webhook_events (event_id, checkout_id, event_type)
  values (p_event_id, p_checkout_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;

  if p_event_type = 'CHECKOUT_PAID' then
    update public.saas_subscriptions
    set status = 'active', trial_ends_at = null, period_ends_at = now() + interval '31 days',
        asaas_customer_id = coalesce(p_customer_id, asaas_customer_id), asaas_checkout_url = null,
        updated_at = now()
    where user_id = v_user_id;
  else
    update public.saas_subscriptions
    set status = 'incomplete', asaas_checkout_id = null, asaas_checkout_url = null, updated_at = now()
    where user_id = v_user_id;
  end if;

  return 'updated';
end;
$$;
revoke all on function public.process_saas_checkout_webhook(text, text, text, text) from public, anon, authenticated;
grant execute on function public.process_saas_checkout_webhook(text, text, text, text) to service_role;
