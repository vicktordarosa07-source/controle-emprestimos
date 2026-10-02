-- Reativa 7 dias de trial. Execute quando terminar o teste de cobrança.
begin;

update public.saas_billing_settings
set trial_days = 7, updated_at = now()
where singleton = true;

-- Restaura o restante do trial somente para contas sem assinatura Asaas.
-- Assinaturas já iniciadas durante o teste não recebem acesso grátis.
update public.saas_subscriptions s
set trial_ends_at = u.created_at + interval '7 days', updated_at = now()
from auth.users u
where u.id = s.user_id
  and s.status in ('trialing', 'canceled')
  and s.plan_key = 'trial'
  and s.asaas_subscription_id is null
  and (s.period_ends_at is null or s.period_ends_at <= now());

commit;
