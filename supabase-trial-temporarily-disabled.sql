-- Pausa temporariamente o período grátis para novos e atuais trials.
-- Execute no SQL Editor do Supabase após publicar o código que lê trial_days.
begin;

alter table public.saas_billing_settings
  add column if not exists trial_days integer not null default 7;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'saas_billing_settings_trial_days_check'
      and conrelid = 'public.saas_billing_settings'::regclass
  ) then
    alter table public.saas_billing_settings
      add constraint saas_billing_settings_trial_days_check
      check (trial_days between 0 and 365);
  end if;
end;
$$;

create or replace function public.create_saas_trial_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial_days integer;
begin
  select settings.trial_days into v_trial_days
  from public.saas_billing_settings settings
  where settings.singleton = true;

  if not found then
    v_trial_days := 7;
  end if;

  insert into public.saas_subscriptions (user_id, plan_key, status, trial_ends_at)
  values (
    new.id,
    'trial',
    'trialing',
    new.created_at + make_interval(days => v_trial_days)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

update public.saas_billing_settings
set trial_days = 0, updated_at = now()
where singleton = true;

-- Encerra trials em andamento; assinaturas canceladas ainda respeitam
-- period_ends_at quando houver período pago vigente.
update public.saas_subscriptions
set trial_ends_at = now(), updated_at = now()
where status in ('trialing', 'canceled');

commit;
