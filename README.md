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
- Fila de lembretes para parcelas vencidas, do dia e dos próximos 7 dias, com registro manual de contatos.
- Resumo financeiro mensal, comparação com o mês anterior e histórico de rateio dos pagamentos.
- Arquivamento recuperável de cobranças pela Lixeira; exportação CSV compatível com Excel e backup JSON.
- Histórico de cobranças já existentes continua usando as regras registradas anteriormente.

## Configuração local

1. Copie `.env.example` para `.env.local` e configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Instale as dependências e rode `npm run dev`.

## Supabase e migração

Para um banco já usado por esta aplicação, execute `supabase-cobrancas.sql`, `supabase-cadastro-aberto.sql` e `supabase-recursos-operacionais.sql` no SQL Editor. A migração operacional adiciona histórico transacional, contatos e campos de arquivamento sem apagar dados existentes. **Aplique-a antes de publicar o código que usa os novos recursos.**

Pagamentos anteriores à migração continuam nos saldos existentes, mas não é possível reconstruir com precisão o histórico de cada recebimento parcial nem sua data; o novo livro-caixa registra as movimentações feitas após a migração. O backup JSON é uma exportação para guarda externa, não um importador automático. A lixeira recupera cobranças arquivadas dentro do app.

Para uma instalação nova, primeiro configure o esquema-base descrito em `supabase-production.sql` (incluindo o backfill de `OWNER_USER_ID`, quando aplicável) e depois execute as duas migrações acima. Não execute o esquema-base sobre uma instalação existente sem revisar o arquivo: ele contém passos de configuração inicial que não são uma migração geral idempotente.

Ative Email/Password e a opção de cadastro de novos usuários em Authentication > Providers. Configure os redirects de autenticação para o domínio da aplicação. O cadastro é público; cada conta nova recebe acesso normal e fica isolada dos dados das outras contas. Usuários anteriormente pendentes são liberados pela migração de cadastro aberto; contas bloqueadas continuam bloqueadas. Se a confirmação de e-mail estiver ativada no Supabase, a pessoa precisará confirmar o endereço antes do primeiro login.

## Pagamentos e Asaas

O app controla vencimentos e pagamentos informados manualmente. Integração com Asaas — criação de cobranças externas, links de pagamento, webhooks e conciliação — ainda não está implementada; não há promessa de que um pagamento lançado aqui tenha sido processado pelo Asaas.

## Comandos

```bash
npm run dev
npm run build
npm run lint
```

## Deploy

Configure as variáveis do Supabase no provedor de deploy. Aplique as migrações necessárias no Supabase antes de publicar o código que depende delas.
