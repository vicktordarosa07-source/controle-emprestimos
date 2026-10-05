-- Auditoria somente de leitura para preparar o CredCash para venda.
-- Rode no SQL Editor do projeto Supabase de PRODUÇÃO. Não lê registros de clientes,
-- não altera dados e não ativa enforcement.

with expected(table_name) as (
  values
    ('profiles'), ('clientes'), ('emprestimos'), ('parcelas'),
    ('pagamentos'), ('pagamento_itens'), ('cobranca_contatos'),
    ('saas_subscriptions'), ('saas_billing_settings'),
    ('saas_webhook_events'), ('saas_checkout_webhook_events'),
    ('asaas_connections'), ('asaas_charges'), ('asaas_webhook_events'),
    ('email_reminder_deliveries')
)
select
  expected.table_name,
  coalesce(n.nspname = 'public' and c.relkind in ('r', 'p'), false) as exists_in_public,
  coalesce(c.relrowsecurity, false) as rls_enabled,
  coalesce(c.relforcerowsecurity, false) as rls_forced
from expected
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = expected.table_name
order by expected.table_name;

-- Mostra políticas aplicadas, sem qualquer dado de negócio.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'clientes', 'emprestimos', 'parcelas', 'pagamentos',
    'pagamento_itens', 'cobranca_contatos', 'saas_subscriptions',
    'saas_billing_settings', 'saas_webhook_events',
    'saas_checkout_webhook_events', 'asaas_connections', 'asaas_charges',
    'asaas_webhook_events', 'email_reminder_deliveries'
  )
order by tablename, policyname;

-- Privilégios diretos para roles expostas à API. Investigue grants inesperados.
select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in (
    'profiles', 'clientes', 'emprestimos', 'parcelas', 'pagamentos',
    'pagamento_itens', 'cobranca_contatos', 'saas_subscriptions',
    'saas_billing_settings', 'saas_webhook_events',
    'saas_checkout_webhook_events', 'asaas_connections', 'asaas_charges',
    'asaas_webhook_events', 'email_reminder_deliveries'
  )
order by table_name, grantee, privilege_type;

-- Deve retornar uma linha com enforcement_enabled = false enquanto o fluxo
-- de cobrança ainda não tiver sido testado e aprovado.
select singleton, enforcement_enabled
from public.saas_billing_settings
where singleton = true;
