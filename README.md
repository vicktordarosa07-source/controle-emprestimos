# CredCash — gestão de cobranças

Aplicação privada para organizar clientes, cobranças parceladas ou recorrentes, vencimentos e pagamentos. O projeto mantém os nomes históricos das tabelas (`emprestimos` e `parcelas`) para preservar compatibilidade com os dados existentes.

**Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS e Supabase.

## Funcionalidades

- Login e isolamento de dados por usuário com Supabase Auth/RLS.
- Dashboard de valores recebidos, em aberto e atrasados, busca e filtros.
- Cadastro de cobrança com descrição opcional e dados de contato não obrigatórios.
- Divisão exata do valor total em até 120 ocorrências, sem juros automáticos.
- Frequência semanal, quinzenal, mensal ou intervalo personalizado de 1 a 365 dias.
- Registro de pagamentos parciais e totais e opção para reabrir cobrança paga.
- Fila de lembretes para parcelas vencidas, do dia e dos próximos 7 dias, com registro manual de contatos; resumo diário por e-mail opcional ao dono da conta.
- Resumo financeiro mensal, comparação com o mês anterior e histórico de rateio dos pagamentos.
- Arquivamento recuperável de cobranças pela Lixeira; exportação CSV compatível com Excel, backup JSON e importação transacional sem sobrescrever IDs.
- Registro manual de pagamentos parciais ou totais, com histórico e atualização dos saldos.
- MFA TOTP opcional e testes automatizados das regras financeiras centrais.
- Histórico de cobranças já existentes continua usando as regras registradas anteriormente.

## Configuração local

1. Copie `.env.example` para `.env.local` e configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Instale as dependências e rode `npm run dev`.

## Supabase e migração

Para um banco já usado por esta aplicação, execute `supabase-cobrancas.sql`, `supabase-cadastro-aberto.sql`, `supabase-recursos-operacionais.sql`, `supabase-saas-fundacao.sql` e, por último, `supabase-trial-acesso.sql` no SQL Editor. As migrações são aditivas e preservam registros. O enforcement de assinatura começa desligado; só ative depois de validar cobrança, webhooks e datas de trial.

Pagamentos anteriores à migração continuam nos saldos existentes, mas não é possível reconstruir com precisão o histórico de cada recebimento parcial nem sua data; o novo livro-caixa registra as movimentações feitas após a migração. A restauração exige um arquivo de backup íntegro do CredCash, é limitada a 5 MB e cancela por completo se qualquer ID já existir; não sobrescreve dados. Backups antigos mantêm o identificador interno `fluxo-backup-v1` por compatibilidade.

Para uma instalação nova, primeiro configure o esquema-base descrito em `supabase-production.sql` (incluindo o backfill de `OWNER_USER_ID`, quando aplicável) e depois execute, em ordem, `supabase-cobrancas.sql`, `supabase-cadastro-aberto.sql`, `supabase-recursos-operacionais.sql`, `supabase-saas-fundacao.sql` e `supabase-trial-acesso.sql`. Não execute o esquema-base sobre uma instalação existente sem revisar o arquivo: ele contém passos de configuração inicial que não são uma migração geral idempotente.

O trial opt-in de 7 dias exige o código atualizado e `supabase-trial-activation.sql`. Publique o código e aplique a migração em uma janela controlada: ela muda o gatilho de novos cadastros para `pending_trial`, cria a ativação única e liga o enforcement. Contas existentes não recebem novo trial; assinaturas pagas não são alteradas. Depois do prazo, o uso operacional fica bloqueado até o pagamento ser confirmado. Consulte [`docs/trial-opt-in.md`](docs/trial-opt-in.md) antes de aplicar em produção.

Ative Email/Password e a opção de cadastro de novos usuários em Authentication > Providers. Em Authentication > URL Configuration, use `https://credcash.vercel.app` como Site URL e permita os redirects `https://credcash.vercel.app/auth/confirm` e `https://credcash.vercel.app/auth/confirm?next=%2Fauth%2Fredefinir-senha`. O domínio antigo `recebify.vercel.app` permanece como redirecionamento para o novo domínio durante a transição. O cadastro é público; após a migração de trial opt-in, cada conta nova fica aguardando a ativação explícita dos 7 dias grátis e isolada dos dados das outras contas. Usuários anteriormente pendentes são liberados pela migração de cadastro aberto; contas bloqueadas continuam bloqueadas. Se a confirmação de e-mail estiver ativada no Supabase, a pessoa precisará confirmar o endereço antes do primeiro login. Para produção, configure SMTP próprio e a política de senha mínima de 8 caracteres no Supabase Auth.

## Asaas, e-mail, cron e segurança

Clientes não conectam provedores de pagamento nem precisam criar chaves. O CredCash usa uma integração privada da plataforma para processar as próprias assinaturas. O endpoint de webhook de cobranças individuais permanece ativo apenas para conciliar links que já tenham sido emitidos anteriormente; não há mais controles para criar novos links no app.

Os resumos diários são opt-in. Para envio, configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET` na Vercel. O cron de `vercel.json` roda diariamente às 12:00 UTC (09:00 em Brasília, fora de mudanças de horário sazonal). O domínio do remetente deve estar validado no Resend.

MFA TOTP é opcional e usa Supabase Auth. A tela e as actions exigem o segundo fator para usuários que o cadastraram. Para proteger também chamadas diretas ao Supabase, aplique `supabase-mfa-rls.sql` e valide as políticas RLS/AAL do projeto.

O preço mensal vem de `SAAS_STARTER_MONTHLY_BRL` na Vercel; o código não fixa um preço comercial. Configure `ASAAS_PLATFORM_API_KEY` e mantenha `ASAAS_PLATFORM_ENV=sandbox` para validar. O webhook da plataforma usa `/api/webhooks/asaas-plataforma` e um segredo aleatório de pelo menos 32 caracteres em `ASAAS_PLATFORM_WEBHOOK_TOKEN`. `ASAAS_PLATFORM_LIVE_BILLING_ENABLED` só deve ser `true` após validar o Sandbox e configurar o webhook. Após `supabase-trial-activation.sql`, o uso operacional fica bloqueado antes do trial e depois do fim do período de acesso; confirme as regras de inadimplência e cancelamento antes de vender o serviço.

Antes de vender, siga [`docs/pre-venda.md`](docs/pre-venda.md) e execute a consulta somente de leitura [`supabase-prelaunch-audit.sql`](supabase-prelaunch-audit.sql) no projeto Supabase correto. A lista audita o estado remoto sem alterar dados; o código local, sozinho, não comprova quais migrations e políticas estão aplicadas na produção.

## Comandos

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Deploy

Configure as variáveis do Supabase no provedor de deploy. Aplique as migrações necessárias no Supabase antes de publicar o código que depende delas.
