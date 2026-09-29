-- Execute no SQL Editor do Supabase depois das migrations base e SaaS.
-- A proteção começa desativada: valide planos, webhook e trial antes de ativar.
begin;

create table if not exists public.saas_billing_settings (
  singleton boolean primary key default true check (singleton),
  enforcement_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.saas_billing_settings (singleton, enforcement_enabled)
values (true, false)
on conflict (singleton) do nothing;
alter table public.saas_billing_settings enable row level security;
revoke all on public.saas_billing_settings from anon, authenticated;
grant all on public.saas_billing_settings to service_role;

-- Contas existentes e futuras recebem trial desde o instante em que foram criadas.
create or replace function public.create_saas_trial_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.saas_subscriptions (user_id, plan_key, status, trial_ends_at)
  values (new.id, 'trial', 'trialing', new.created_at + interval '7 days')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_saas_trial_after_signup on auth.users;
create trigger create_saas_trial_after_signup
after insert on auth.users
for each row execute function public.create_saas_trial_for_new_user();

insert into public.saas_subscriptions (user_id, plan_key, status, trial_ends_at)
select u.id, 'trial', 'trialing', u.created_at + interval '7 days'
from auth.users u
on conflict (user_id) do nothing;

update public.saas_subscriptions s
set trial_ends_at = u.created_at + interval '7 days', updated_at = now()
from auth.users u
where u.id = s.user_id
  and s.status = 'trialing'
  and (s.trial_ends_at is null or s.trial_ends_at > u.created_at + interval '7 days');

create or replace function public.has_saas_write_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when not coalesce((select settings.enforcement_enabled
      from public.saas_billing_settings settings where settings.singleton), false) then true
    when public.is_admin_user() or public.is_dev_user() then true
    when not public.is_approved_user() then false
    else exists (
      select 1
      from public.saas_subscriptions subscription
      where subscription.user_id = auth.uid()
        and (
          (subscription.status = 'trialing' and subscription.trial_ends_at > now())
          or (subscription.status = 'active' and coalesce(subscription.period_ends_at, 'infinity'::timestamptz) > now())
          or (subscription.status = 'canceled' and greatest(
            coalesce(subscription.period_ends_at, '-infinity'::timestamptz),
            coalesce(subscription.trial_ends_at, '-infinity'::timestamptz)
          ) > now())
          or (subscription.status = 'past_due' and subscription.period_ends_at > now() - interval '3 days')
        )
    )
  end;
$$;
revoke all on function public.has_saas_write_access() from public, anon;
grant execute on function public.has_saas_write_access() to authenticated;

create or replace function public.get_own_saas_access()
returns table (
  enforcement_enabled boolean,
  can_write boolean,
  subscription_status text,
  access_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select settings.enforcement_enabled from public.saas_billing_settings settings where settings.singleton), false),
    public.has_saas_write_access(),
    subscription.status,
    case
      when subscription.status = 'trialing' then subscription.trial_ends_at
      when subscription.status in ('active', 'past_due') then subscription.period_ends_at
      when subscription.status = 'canceled' then greatest(subscription.period_ends_at, subscription.trial_ends_at)
      else null
    end
  from (select auth.uid() as user_id) request_user
  left join public.saas_subscriptions subscription on subscription.user_id = request_user.user_id;
$$;
revoke all on function public.get_own_saas_access() from public, anon;
grant execute on function public.get_own_saas_access() to authenticated;

-- Separate read policies from writes so expired accounts can still consult/export data.
do $$
declare policy_name text;
begin
  foreach policy_name in array array['clientes leitura propria','clientes inserir com acesso','clientes atualizar com acesso','clientes excluir com acesso'] loop
    execute format('drop policy if exists %I on public.clientes', policy_name);
  end loop;
  foreach policy_name in array array['emprestimos leitura propria','emprestimos inserir com acesso','emprestimos atualizar com acesso','emprestimos excluir com acesso'] loop
    execute format('drop policy if exists %I on public.emprestimos', policy_name);
  end loop;
  foreach policy_name in array array['parcelas leitura propria','parcelas inserir com acesso','parcelas atualizar com acesso','parcelas excluir com acesso'] loop
    execute format('drop policy if exists %I on public.parcelas', policy_name);
  end loop;
  foreach policy_name in array array['pagamentos leitura propria','pagamentos inserir com acesso','pagamentos atualizar com acesso','pagamentos excluir com acesso'] loop
    execute format('drop policy if exists %I on public.pagamentos', policy_name);
  end loop;
  foreach policy_name in array array['itens pagamentos leitura propria','itens pagamentos inserir com acesso','itens pagamentos atualizar com acesso','itens pagamentos excluir com acesso'] loop
    execute format('drop policy if exists %I on public.pagamento_itens', policy_name);
  end loop;
  foreach policy_name in array array['contatos leitura propria','contatos inserir com acesso','contatos atualizar com acesso','contatos excluir com acesso'] loop
    execute format('drop policy if exists %I on public.cobranca_contatos', policy_name);
  end loop;
end;
$$;

drop policy if exists "clientes por usuario" on public.clientes;
create policy "clientes leitura propria" on public.clientes for select to authenticated
using (user_id = (select auth.uid()) and public.is_approved_user());
create policy "clientes inserir com acesso" on public.clientes for insert to authenticated
with check (user_id = (select auth.uid()) and public.is_approved_user() and public.has_saas_write_access());
create policy "clientes atualizar com acesso" on public.clientes for update to authenticated
using (user_id = (select auth.uid()) and public.is_approved_user() and public.has_saas_write_access())
with check (user_id = (select auth.uid()) and public.is_approved_user() and public.has_saas_write_access());
create policy "clientes excluir com acesso" on public.clientes for delete to authenticated
using (user_id = (select auth.uid()) and public.is_approved_user() and public.has_saas_write_access());

drop policy if exists "emprestimos por usuario" on public.emprestimos;
create policy "emprestimos leitura propria" on public.emprestimos for select to authenticated
using (public.is_approved_user() and exists (select 1 from public.clientes c where c.id = emprestimos.cliente_id and c.user_id = (select auth.uid())));
create policy "emprestimos inserir com acesso" on public.emprestimos for insert to authenticated
with check (public.is_approved_user() and public.has_saas_write_access() and exists (select 1 from public.clientes c where c.id = emprestimos.cliente_id and c.user_id = (select auth.uid())));
create policy "emprestimos atualizar com acesso" on public.emprestimos for update to authenticated
using (public.is_approved_user() and public.has_saas_write_access() and exists (select 1 from public.clientes c where c.id = emprestimos.cliente_id and c.user_id = (select auth.uid())))
with check (public.is_approved_user() and public.has_saas_write_access() and exists (select 1 from public.clientes c where c.id = emprestimos.cliente_id and c.user_id = (select auth.uid())));
create policy "emprestimos excluir com acesso" on public.emprestimos for delete to authenticated
using (public.is_approved_user() and public.has_saas_write_access() and exists (select 1 from public.clientes c where c.id = emprestimos.cliente_id and c.user_id = (select auth.uid())));

drop policy if exists "parcelas por usuario" on public.parcelas;
create policy "parcelas leitura propria" on public.parcelas for select to authenticated
using (public.is_approved_user() and exists (select 1 from public.emprestimos e join public.clientes c on c.id = e.cliente_id where e.id = parcelas.emprestimo_id and c.user_id = (select auth.uid())));
create policy "parcelas inserir com acesso" on public.parcelas for insert to authenticated
with check (public.is_approved_user() and public.has_saas_write_access() and exists (select 1 from public.emprestimos e join public.clientes c on c.id = e.cliente_id where e.id = parcelas.emprestimo_id and c.user_id = (select auth.uid())));
create policy "parcelas atualizar com acesso" on public.parcelas for update to authenticated
using (public.is_approved_user() and public.has_saas_write_access() and exists (select 1 from public.emprestimos e join public.clientes c on c.id = e.cliente_id where e.id = parcelas.emprestimo_id and c.user_id = (select auth.uid())))
with check (public.is_approved_user() and public.has_saas_write_access() and exists (select 1 from public.emprestimos e join public.clientes c on c.id = e.cliente_id where e.id = parcelas.emprestimo_id and c.user_id = (select auth.uid())));
create policy "parcelas excluir com acesso" on public.parcelas for delete to authenticated
using (public.is_approved_user() and public.has_saas_write_access() and exists (select 1 from public.emprestimos e join public.clientes c on c.id = e.cliente_id where e.id = parcelas.emprestimo_id and c.user_id = (select auth.uid())));

drop policy if exists "pagamentos do proprio usuario" on public.pagamentos;
create policy "pagamentos leitura propria" on public.pagamentos for select to authenticated using (user_id = (select auth.uid()));
create policy "pagamentos inserir com acesso" on public.pagamentos for insert to authenticated
with check (user_id = (select auth.uid()) and public.has_saas_write_access() and exists (select 1 from public.clientes c where c.id = cliente_id and c.user_id = (select auth.uid())));
create policy "pagamentos atualizar com acesso" on public.pagamentos for update to authenticated
using (user_id = (select auth.uid()) and public.has_saas_write_access())
with check (user_id = (select auth.uid()) and public.has_saas_write_access() and exists (select 1 from public.clientes c where c.id = cliente_id and c.user_id = (select auth.uid())));
create policy "pagamentos excluir com acesso" on public.pagamentos for delete to authenticated
using (user_id = (select auth.uid()) and public.has_saas_write_access());

drop policy if exists "itens de pagamentos do proprio usuario" on public.pagamento_itens;
create policy "itens pagamentos leitura propria" on public.pagamento_itens for select to authenticated
using (exists (select 1 from public.pagamentos p where p.id = pagamento_id and p.user_id = (select auth.uid())));
create policy "itens pagamentos inserir com acesso" on public.pagamento_itens for insert to authenticated
with check (public.has_saas_write_access() and exists (
  select 1 from public.pagamentos pg join public.parcelas pa on pa.id = parcela_id
  join public.emprestimos e on e.id = pa.emprestimo_id join public.clientes c on c.id = e.cliente_id
  where pg.id = pagamento_id and pg.user_id = (select auth.uid()) and c.user_id = (select auth.uid()) and pg.cliente_id = c.id
));
create policy "itens pagamentos atualizar com acesso" on public.pagamento_itens for update to authenticated
using (public.has_saas_write_access() and exists (select 1 from public.pagamentos p where p.id = pagamento_id and p.user_id = (select auth.uid())))
with check (public.has_saas_write_access() and exists (
  select 1 from public.pagamentos pg join public.parcelas pa on pa.id = parcela_id
  join public.emprestimos e on e.id = pa.emprestimo_id join public.clientes c on c.id = e.cliente_id
  where pg.id = pagamento_id and pg.user_id = (select auth.uid()) and c.user_id = (select auth.uid()) and pg.cliente_id = c.id
));
create policy "itens pagamentos excluir com acesso" on public.pagamento_itens for delete to authenticated
using (public.has_saas_write_access() and exists (select 1 from public.pagamentos p where p.id = pagamento_id and p.user_id = (select auth.uid())));

drop policy if exists "contatos das proprias cobrancas" on public.cobranca_contatos;
create policy "contatos leitura propria" on public.cobranca_contatos for select to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.parcelas p join public.emprestimos e on e.id = p.emprestimo_id join public.clientes c on c.id = e.cliente_id where p.id = parcela_id and c.user_id = (select auth.uid())));
create policy "contatos inserir com acesso" on public.cobranca_contatos for insert to authenticated
with check (user_id = (select auth.uid()) and public.has_saas_write_access() and exists (select 1 from public.parcelas p join public.emprestimos e on e.id = p.emprestimo_id join public.clientes c on c.id = e.cliente_id where p.id = parcela_id and c.user_id = (select auth.uid())));
create policy "contatos atualizar com acesso" on public.cobranca_contatos for update to authenticated
using (user_id = (select auth.uid()) and public.has_saas_write_access())
with check (user_id = (select auth.uid()) and public.has_saas_write_access() and exists (select 1 from public.parcelas p join public.emprestimos e on e.id = p.emprestimo_id join public.clientes c on c.id = e.cliente_id where p.id = parcela_id and c.user_id = (select auth.uid())));
create policy "contatos excluir com acesso" on public.cobranca_contatos for delete to authenticated
using (user_id = (select auth.uid()) and public.has_saas_write_access());

-- Ative somente após confirmar os planos e testar webhooks com cobranças reais controladas:
-- update public.saas_billing_settings set enforcement_enabled = true, updated_at = now() where singleton = true;
commit;
