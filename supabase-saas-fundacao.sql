-- Fundação de SaaS: preferências, restauração transacional e integrações opcionais.
-- A migração não ativa cobrança recorrente nem envia e-mails por conta própria.

alter table public.profiles
  add column if not exists email_reminders_enabled boolean not null default false;

alter table public.clientes
  add column if not exists asaas_customer_id text;

create or replace function public.update_own_email_reminders(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sessao expirada.';
  end if;
  update public.profiles
  set email_reminders_enabled = coalesce(p_enabled, false), updated_at = now()
  where id = (select auth.uid());
  if not found then raise exception 'Perfil nao encontrado.'; end if;
end;
$$;

revoke all on function public.update_own_email_reminders(boolean) from public, anon;
grant execute on function public.update_own_email_reminders(boolean) to authenticated;

create table if not exists public.email_reminder_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  send_date date not null,
  status text not null check (status in ('sending','sent','failed')),
  attempts integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, send_date)
);
alter table public.email_reminder_deliveries enable row level security;
revoke all on table public.email_reminder_deliveries from anon, authenticated;
grant all on table public.email_reminder_deliveries to service_role;

create or replace function public.claim_email_reminder(p_user_id uuid, p_send_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_reminder_deliveries as delivery (user_id, send_date, status)
  values (p_user_id, p_send_date, 'sending')
  on conflict (user_id, send_date) do update
    set status = 'sending', attempts = delivery.attempts + 1, updated_at = now()
    where delivery.status = 'failed';
  return found;
end;
$$;
revoke all on function public.claim_email_reminder(uuid, date) from public, anon, authenticated;
grant execute on function public.claim_email_reminder(uuid, date) to service_role;

create or replace function public.restore_fluxo_backup(p_backup jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tables jsonb;
  v_counts jsonb;
begin
  if v_uid is null then raise exception 'Sessao expirada.'; end if;
  if p_backup is null or p_backup->>'formato' <> 'fluxo-backup-v1' then
    raise exception 'Formato de backup invalido.';
  end if;
  v_tables := p_backup->'tabelas';
  if jsonb_typeof(v_tables) <> 'object' then raise exception 'Backup sem tabelas validas.'; end if;
  if octet_length(p_backup::text) > 5000000 then raise exception 'Backup excede o limite de 5 MB.'; end if;
  if exists (
    select 1 from unnest(array['clientes','emprestimos','parcelas','pagamentos','pagamento_itens','cobranca_contatos']) k
    where v_tables ? k and jsonb_typeof(v_tables->k) <> 'array'
  ) then raise exception 'Uma das tabelas do backup nao e uma lista valida.'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(v_tables->'clientes', '[]'::jsonb)) r
    where jsonb_typeof(r) <> 'object' or nullif(r->>'id', '') is null or nullif(r->>'nome', '') is null
  ) then raise exception 'Backup contem cliente invalido.'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_tables->'emprestimos', '[]'::jsonb)) r
    where jsonb_typeof(r) <> 'object' or nullif(r->>'id', '') is null or nullif(r->>'cliente_id', '') is null
  ) then raise exception 'Backup contem cobranca invalida.'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_tables->'parcelas', '[]'::jsonb)) r
    where jsonb_typeof(r) <> 'object' or nullif(r->>'id', '') is null or nullif(r->>'emprestimo_id', '') is null
  ) then raise exception 'Backup contem parcela invalida.'; end if;

  -- Importação aditiva: qualquer ID repetido causa rollback integral, nunca sobrescreve dados.
  insert into public.clientes
  select (jsonb_populate_record(
    null::public.clientes,
    jsonb_set(jsonb_set(r, '{user_id}', to_jsonb(v_uid), true), '{asaas_customer_id}', 'null'::jsonb, true)
  )).*
  from jsonb_array_elements(coalesce(v_tables->'clientes', '[]'::jsonb)) r;
  insert into public.emprestimos
  select (jsonb_populate_record(null::public.emprestimos, r)).*
  from jsonb_array_elements(coalesce(v_tables->'emprestimos', '[]'::jsonb)) r;
  insert into public.parcelas
  select (jsonb_populate_record(null::public.parcelas, r)).*
  from jsonb_array_elements(coalesce(v_tables->'parcelas', '[]'::jsonb)) r;
  insert into public.pagamentos
  select (jsonb_populate_record(null::public.pagamentos, jsonb_set(r, '{user_id}', to_jsonb(v_uid), true))).*
  from jsonb_array_elements(coalesce(v_tables->'pagamentos', '[]'::jsonb)) r;
  insert into public.pagamento_itens
  select (jsonb_populate_record(null::public.pagamento_itens, r)).*
  from jsonb_array_elements(coalesce(v_tables->'pagamento_itens', '[]'::jsonb)) r;
  insert into public.cobranca_contatos
  select (jsonb_populate_record(null::public.cobranca_contatos, jsonb_set(r, '{user_id}', to_jsonb(v_uid), true))).*
  from jsonb_array_elements(coalesce(v_tables->'cobranca_contatos', '[]'::jsonb)) r;

  v_counts := jsonb_build_object(
    'clientes', jsonb_array_length(coalesce(v_tables->'clientes', '[]'::jsonb)),
    'emprestimos', jsonb_array_length(coalesce(v_tables->'emprestimos', '[]'::jsonb)),
    'parcelas', jsonb_array_length(coalesce(v_tables->'parcelas', '[]'::jsonb)),
    'pagamentos', jsonb_array_length(coalesce(v_tables->'pagamentos', '[]'::jsonb)),
    'pagamento_itens', jsonb_array_length(coalesce(v_tables->'pagamento_itens', '[]'::jsonb)),
    'cobranca_contatos', jsonb_array_length(coalesce(v_tables->'cobranca_contatos', '[]'::jsonb))
  );
  return v_counts;
end;
$$;

revoke all on function public.restore_fluxo_backup(jsonb) from public, anon;
grant execute on function public.restore_fluxo_backup(jsonb) to authenticated;

-- Segredos de integrações são acessíveis somente pelo backend usando service role.
create table if not exists public.asaas_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  credential_ciphertext text not null,
  credential_iv text not null,
  credential_tag text not null,
  webhook_token_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.asaas_connections enable row level security;
revoke all on table public.asaas_connections from anon, authenticated;
grant all on table public.asaas_connections to service_role;

create table if not exists public.asaas_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parcela_id uuid not null references public.parcelas(id) on delete cascade,
  asaas_payment_id text not null,
  amount numeric(12,2) not null check (amount > 0),
  interest numeric(12,2) not null default 0 check (interest >= 0),
  status text not null default 'PENDING',
  invoice_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, asaas_payment_id)
);
create index if not exists asaas_charges_parcela_idx on public.asaas_charges (parcela_id);
alter table public.asaas_charges enable row level security;
drop policy if exists "asaas charges do proprio usuario" on public.asaas_charges;
create policy "asaas charges do proprio usuario" on public.asaas_charges
for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate, references, trigger on public.asaas_charges from authenticated, anon;
grant select on public.asaas_charges to authenticated;
grant all on public.asaas_charges to service_role;

create table if not exists public.asaas_webhook_events (
  event_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  asaas_payment_id text not null,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table public.asaas_webhook_events enable row level security;
revoke all on table public.asaas_webhook_events from anon, authenticated;
grant all on table public.asaas_webhook_events to service_role;

create or replace function public.process_asaas_webhook(
  p_user_id uuid,
  p_event_id text,
  p_payment_id text,
  p_event_type text,
  p_value numeric,
  p_received_on date default current_date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge record;
  v_installment record;
  v_payment_id uuid;
  v_value numeric(12,2) := round(p_value, 2);
  v_interest numeric(12,2);
  v_principal numeric(12,2);
begin
  if p_user_id is null or nullif(p_event_id, '') is null or nullif(p_payment_id, '') is null then
    raise exception 'Evento Asaas incompleto.';
  end if;
  insert into public.asaas_webhook_events (event_id, user_id, asaas_payment_id, event_type)
  values (p_event_id, p_user_id, p_payment_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;

  select * into v_charge
  from public.asaas_charges
  where user_id = p_user_id and asaas_payment_id = p_payment_id
  for update;
  if not found then raise exception 'Cobranca vinculada nao encontrada.'; end if;

  if p_event_type = 'PAYMENT_RECEIVED' then
    if v_charge.status = 'RECEIVED' then return 'already_received'; end if;
    select p.id, p.valor, p.valor_pago, p.valor_juros_atraso_pago, p.status,
      e.cliente_id, c.user_id
    into v_installment
    from public.parcelas p
    join public.emprestimos e on e.id = p.emprestimo_id
    join public.clientes c on c.id = e.cliente_id
    where p.id = v_charge.parcela_id and c.user_id = p_user_id
    for update of p;
    if not found then raise exception 'Parcela nao pertence a conta conectada.'; end if;
    v_interest := least(v_value, coalesce(v_charge.interest, 0));
    v_principal := v_value - v_interest;
    if v_value <= 0 or v_principal > (v_installment.valor - coalesce(v_installment.valor_pago, 0)) then
      raise exception 'Valor recebido excede o saldo da parcela.';
    end if;
    insert into public.pagamentos (cliente_id, user_id, valor_total, recebido_em)
    values (v_installment.cliente_id, p_user_id, v_value, coalesce(p_received_on, current_date))
    returning id into v_payment_id;
    insert into public.pagamento_itens (pagamento_id, parcela_id, valor_principal, valor_juros)
    values (v_payment_id, v_installment.id, v_principal, v_interest);
    update public.asaas_charges set status = 'RECEIVED', updated_at = now() where id = v_charge.id;
    update public.parcelas
    set valor_pago = coalesce(valor_pago, 0) + v_principal,
      valor_juros_atraso_pago = coalesce(valor_juros_atraso_pago, 0) + v_interest,
      status = case when coalesce(valor_pago, 0) + v_principal >= valor then 'Pago' else 'Pendente' end,
      data_pagamento = case when coalesce(valor_pago, 0) + v_principal >= valor then coalesce(p_received_on, current_date) else null end
    where id = v_installment.id;
    return 'received';
  end if;

  update public.asaas_charges
  set status = left(coalesce(p_event_type, 'UNKNOWN'), 80), updated_at = now()
  where id = v_charge.id;
  return 'updated';
end;
$$;

revoke all on function public.process_asaas_webhook(uuid, text, text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.process_asaas_webhook(uuid, text, text, text, numeric, date) to service_role;

create or replace function public.block_manual_settlement_with_active_asaas_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and coalesce(new.valor_pago, 0) > coalesce(old.valor_pago, 0)
     and exists (
       select 1 from public.asaas_charges ac
       where ac.parcela_id = old.id
         and ac.status in ('PENDING','OVERDUE','CONFIRMED')
     ) then
    raise exception 'Cancele o link Asaas ativo antes de registrar pagamento manual.';
  end if;
  return new;
end;
$$;
drop trigger if exists block_manual_settlement_with_active_asaas_charge on public.parcelas;
create trigger block_manual_settlement_with_active_asaas_charge
before update of valor_pago on public.parcelas
for each row execute function public.block_manual_settlement_with_active_asaas_charge();

create table if not exists public.saas_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_key text not null default 'trial',
  status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled','incomplete')),
  trial_ends_at timestamptz,
  period_ends_at timestamptz,
  asaas_customer_id text,
  asaas_subscription_id text,
  asaas_checkout_id text,
  asaas_checkout_url text,
  asaas_environment text check (asaas_environment in ('sandbox','production')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.saas_subscriptions enable row level security;
drop policy if exists "assinatura propria leitura" on public.saas_subscriptions;
create policy "assinatura propria leitura" on public.saas_subscriptions
for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate, references, trigger on public.saas_subscriptions from authenticated, anon;
grant select on public.saas_subscriptions to authenticated;
grant all on public.saas_subscriptions to service_role;

comment on table public.saas_subscriptions is 'Estado de assinatura; acesso não é bloqueado até configuração explícita da cobrança do SaaS.';

create table if not exists public.saas_webhook_events (
  event_id text primary key,
  subscription_id text not null,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table public.saas_webhook_events enable row level security;
revoke all on table public.saas_webhook_events from anon, authenticated;
grant all on table public.saas_webhook_events to service_role;

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
  p_event_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; begin
  select user_id into v_user_id from public.saas_subscriptions
  where asaas_subscription_id = p_subscription_id for update;
  if not found then return 'unlinked'; end if;
  insert into public.saas_webhook_events (event_id, subscription_id, event_type)
  values (p_event_id, p_subscription_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;
  if p_event_type = 'PAYMENT_RECEIVED' then
    update public.saas_subscriptions set status = 'active',
      period_ends_at = now() + interval '31 days', updated_at = now()
    where user_id = v_user_id;
  elsif p_event_type = 'PAYMENT_OVERDUE' then
    update public.saas_subscriptions set status = 'past_due', updated_at = now()
    where user_id = v_user_id;
  elsif p_event_type = 'SUBSCRIPTION_DELETED' then
    update public.saas_subscriptions set status = 'canceled', updated_at = now()
    where user_id = v_user_id;
  end if;
  return 'updated';
end;
$$;

revoke all on function public.process_saas_billing_webhook(text, text, text) from public, anon, authenticated;
grant execute on function public.process_saas_billing_webhook(text, text, text) to service_role;

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
