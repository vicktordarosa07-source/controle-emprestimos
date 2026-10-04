-- Apply after deploying the opt-in trial UI. Does not restart old trials.
begin;

alter table public.saas_subscriptions
  add column if not exists trial_started_at timestamptz;

alter table public.saas_subscriptions
  drop constraint if exists saas_subscriptions_status_check;
alter table public.saas_subscriptions
  add constraint saas_subscriptions_status_check
  check (status in ('pending_trial', 'trialing', 'active', 'past_due', 'canceled', 'incomplete'));

insert into public.saas_billing_settings (singleton, trial_days, enforcement_enabled, updated_at)
values (true, 7, true, now())
on conflict (singleton) do update
set trial_days = 7, enforcement_enabled = true, updated_at = now();

-- New accounts wait for an explicit click. Existing subscriptions stay untouched.
create or replace function public.create_saas_trial_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.saas_subscriptions (user_id, plan_key, status, trial_ends_at)
  values (new.id, 'trial', 'pending_trial', null)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_saas_trial_after_signup on auth.users;
create trigger create_saas_trial_after_signup
after insert on auth.users
for each row execute function public.create_saas_trial_for_new_user();

create or replace function public.activate_own_saas_trial()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_days integer;
  v_ends_at timestamptz;
begin
  if v_user_id is null or not public.mfa_session_satisfied() or not public.is_approved_user() then
    raise exception 'Entre na conta e conclua a verificação para ativar o teste.';
  end if;

  select trial_days into v_days
  from public.saas_billing_settings where singleton = true;
  if v_days is distinct from 7 then
    raise exception 'O teste grátis não está disponível neste momento.';
  end if;

  update public.saas_subscriptions
  set status = 'trialing', trial_started_at = now(),
      trial_ends_at = now() + interval '7 days', updated_at = now()
  where user_id = v_user_id
    and status = 'pending_trial'
    and trial_started_at is null
    and asaas_subscription_id is null
    and asaas_checkout_id is null
  returning trial_ends_at into v_ends_at;

  if v_ends_at is null then
    raise exception 'Este teste já foi iniciado ou não está disponível para esta conta.';
  end if;
  return v_ends_at;
end;
$$;
revoke all on function public.activate_own_saas_trial() from public, anon;
grant execute on function public.activate_own_saas_trial() to authenticated;

commit;
