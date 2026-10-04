-- Execute depois de supabase-asaas-checkout.sql e antes de publicar a opção Pix.
-- A migração é segura para ser executada mais de uma vez.

alter table public.saas_subscriptions
  add column if not exists asaas_billing_type text,
  add column if not exists asaas_pix_creation_started_at timestamptz;

update public.saas_subscriptions
set asaas_billing_type = 'CREDIT_CARD'
where asaas_billing_type is null
  and asaas_checkout_id is not null;

create or replace function public.reserve_saas_pix_creation(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.saas_subscriptions
  set asaas_pix_creation_started_at = now(),
      asaas_subscription_id = case when status = 'canceled' then null else asaas_subscription_id end,
      asaas_checkout_id = case when status = 'canceled' then null else asaas_checkout_id end,
      asaas_checkout_url = case when status = 'canceled' then null else asaas_checkout_url end
  where user_id = p_user_id
    and status in ('trialing', 'incomplete', 'canceled')
    and (status = 'canceled' or asaas_subscription_id is null)
    and (asaas_pix_creation_started_at is null or asaas_pix_creation_started_at < now() - interval '10 minutes');
  return found;
end;
$$;

create or replace function public.release_saas_pix_creation(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.saas_subscriptions
  set asaas_pix_creation_started_at = null
  where user_id = p_user_id;
$$;

revoke all on function public.reserve_saas_pix_creation(uuid) from public, anon, authenticated;
revoke all on function public.release_saas_pix_creation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_saas_pix_creation(uuid) to service_role;
grant execute on function public.release_saas_pix_creation(uuid) to service_role;

-- Permite vincular SUBSCRIPTION_CREATED pelo externalReference mesmo se o
-- webhook chegar antes da resposta da API ser salva na tabela.
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
