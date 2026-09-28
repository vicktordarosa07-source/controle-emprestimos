# Fluxo — gestão de cobranças

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
- Conexão individual com Asaas (Sandbox/Produção), link de pagamento por parcela e conciliação idempotente via webhook.
- MFA TOTP opcional e testes automatizados das regras financeiras centrais.
- Histórico de cobranças já existentes continua usando as regras registradas anteriormente.

## Configuração local

1. Copie `.env.example` para `.env.local` e configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Instale as dependências e rode `npm run dev`.

## Supabase e migração

Para um banco já usado por esta aplicação, execute `supabase-cobrancas.sql`, `supabase-cadastro-aberto.sql`, `supabase-recursos-operacionais.sql` e `supabase-saas-fundacao.sql` no SQL Editor. A última migração adiciona preferências e recursos para restauração e integrações sem apagar registros existentes. **Aplique-a antes de publicar o código que usa os novos recursos.**

Pagamentos anteriores à migração continuam nos saldos existentes, mas não é possível reconstruir com precisão o histórico de cada recebimento parcial nem sua data; o novo livro-caixa registra as movimentações feitas após a migração. A restauração exige o arquivo íntegro do Fluxo, é limitada a 5 MB e cancela por completo se qualquer ID já existir; não sobrescreve dados.

Para uma instalação nova, primeiro configure o esquema-base descrito em `supabase-production.sql` (incluindo o backfill de `OWNER_USER_ID`, quando aplicável) e depois execute, em ordem, `supabase-cobrancas.sql`, `supabase-cadastro-aberto.sql`, `supabase-recursos-operacionais.sql` e `supabase-saas-fundacao.sql`. Não execute o esquema-base sobre uma instalação existente sem revisar o arquivo: ele contém passos de configuração inicial que não são uma migração geral idempotente.

Ative Email/Password e a opção de cadastro de novos usuários em Authentication > Providers. Configure os redirects de autenticação para o domínio da aplicação. O cadastro é público; cada conta nova recebe acesso normal e fica isolada dos dados das outras contas. Usuários anteriormente pendentes são liberados pela migração de cadastro aberto; contas bloqueadas continuam bloqueadas. Se a confirmação de e-mail estiver ativada no Supabase, a pessoa precisará confirmar o endereço antes do primeiro login.

## Asaas, e-mail, cron e segurança

Cada usuário conecta sua própria chave Asaas; não use a conta central do SaaS para movimentar os recebíveis dos clientes. A chave é criptografada com AES-256-GCM no backend. Configure `SUPABASE_SERVICE_ROLE_KEY` e `ASAAS_CREDENTIAL_ENCRYPTION_KEY` na Vercel (32 bytes em hexadecimal). Comece no Sandbox. A escolha de Produção exige confirmação adicional antes de gerar uma cobrança real. O webhook deve ser cadastrado manualmente no painel Asaas com a URL e o token mostrados uma única vez ao conectar; eventos duplicados são deduplicados, e somente `PAYMENT_RECEIVED` lança recebimento no livro-caixa. Teste primeiro com dados e chaves Sandbox.

Os resumos diários são opt-in. Para envio, configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET` na Vercel. O cron de `vercel.json` roda diariamente às 12:00 UTC (09:00 em Brasília, fora de mudanças de horário sazonal). O domínio do remetente deve estar validado no Resend.

MFA TOTP é opcional e usa Supabase Auth. A tela e as actions exigem o segundo fator para usuários que o cadastraram. Para uma política de MFA obrigatória também nas chamadas diretas ao Supabase, ajuste as políticas RLS/AAL do projeto antes de habilitar essa exigência globalmente.

O app oferece a criação de assinatura mensal para o Fluxo, mas preços precisam ser definidos nas variáveis `SAAS_STARTER_MONTHLY_BRL` e `SAAS_PRO_MONTHLY_BRL`. Use `ASAAS_PLATFORM_API_KEY` e `ASAAS_PLATFORM_ENV=sandbox` para validar. Webhook de assinatura requer o endpoint `/api/webhooks/asaas-plataforma` e um segredo aleatório de pelo menos 32 caracteres em `ASAAS_PLATFORM_WEBHOOK_TOKEN`. `ASAAS_PLATFORM_LIVE_BILLING_ENABLED` deve ficar `false` até validar Sandbox e decidir os valores. Limites de uso e bloqueio por inadimplência permanecem desativados: não suspendem os dados ou a conta.

## Comandos

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Deploy

Configure as variáveis do Supabase no provedor de deploy. Aplique as migrações necessárias no Supabase antes de publicar o código que depende delas.
