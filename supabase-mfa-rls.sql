-- Execute uma vez no SQL Editor do Supabase, depois das migrations de produção.
-- MFA continua opcional: só contas com um fator verificado precisam de AAL2.
-- A transação evita aplicar apenas parte das proteções.
begin;

create or replace function public.mfa_session_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      (select auth.jwt()->>'aal') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors factor
        where factor.user_id = (select auth.uid())
          and factor.status = 'verified'
      )
    );
$$;
revoke all on function public.mfa_session_satisfied() from public, anon;
grant execute on function public.mfa_session_satisfied() to authenticated;

-- Restrictive policies are ANDed with existing permissive ownership policies.
-- Include both reads and writes, including tables read directly through PostgREST.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'signup_invites', 'clientes', 'emprestimos', 'parcelas',
    'pagamentos', 'pagamento_itens', 'cobranca_contatos',
    'asaas_charges', 'saas_subscriptions'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'mfa autenticador validado', table_name);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.mfa_session_satisfied())) with check ((select public.mfa_session_satisfied()))',
      'mfa autenticador validado', table_name
    );
  end loop;
end;
$$;

-- These helpers run as their owner, bypassing RLS; they must honor MFA too.
create or replace function public.is_approved_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_session_satisfied() and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'approved'
  );
$$;

create or replace function public.is_admin_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_session_satisfied() and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'approved' and p.is_admin = true
  );
$$;

create or replace function public.is_dev_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.mfa_session_satisfied() and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'approved' and p.is_dev = true
  );
$$;

create or replace function public.has_saas_write_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when not public.mfa_session_satisfied() then false
    when not coalesce((select settings.enforcement_enabled
      from public.saas_billing_settings settings where settings.singleton), false) then true
    when public.is_admin_user() or public.is_dev_user() then true
    when not public.is_approved_user() then false
    else exists (
      select 1 from public.saas_subscriptions subscription
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

create or replace function public.get_own_saas_access()
returns table (
  enforcement_enabled boolean,
  can_write boolean,
  subscription_status text,
  access_until timestamptz
)
language sql stable security definer set search_path = '' as $$
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
  left join public.saas_subscriptions subscription on subscription.user_id = request_user.user_id
  where public.mfa_session_satisfied();
$$;

create or replace function public.update_own_profile_contact(p_fone text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_digits text := regexp_replace(coalesce(p_fone, ''), '[^0-9]', '', 'g');
begin
  if not public.mfa_session_satisfied() then
    raise exception 'Confirme o segundo fator antes de continuar.';
  end if;
  if char_length(v_digits) < 10 or char_length(v_digits) > 15 then
    raise exception 'Telefone deve ter DDD e entre 10 e 15 digitos.';
  end if;
  update public.profiles set fone = trim(p_fone), updated_at = now()
  where id = (select auth.uid());
  if not found then raise exception 'Perfil nao encontrado.'; end if;
end;
$$;

create or replace function public.update_own_email_reminders(p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.mfa_session_satisfied() then
    raise exception 'Confirme o segundo fator antes de continuar.';
  end if;
  update public.profiles
  set email_reminders_enabled = coalesce(p_enabled, false), updated_at = now()
  where id = (select auth.uid());
  if not found then raise exception 'Perfil nao encontrado.'; end if;
end;
$$;

-- Authenticated callers need MFA even when invoking these SECURITY DEFINER RPCs directly.
-- The admin/dev checks above cover create_signup_invite and approve_user_access.
commit;
