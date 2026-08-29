# Controle de Empréstimos - Filipe de Lima

Sistema web de controle de empréstimos, acessível por celular e notebook.

**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase (Postgres)

## Schema Supabase (já criado)
```sql
CREATE TABLE clientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL
);
CREATE TABLE emprestimos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  valor_total NUMERIC NOT NULL,
  juros_percentual NUMERIC NOT NULL,
  qtd_parcelas INT NOT NULL,
  data_primeiro_vencimento DATE NOT NULL
);
CREATE TABLE parcelas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  emprestimo_id UUID REFERENCES emprestimos(id) ON DELETE CASCADE,
  numero INT NOT NULL,
  valor NUMERIC NOT NULL,
  data_vencimento DATE NOT NULL,
  status TEXT DEFAULT 'Pendente',
  data_pagamento DATE
);
```

## Configuração
1. Copie `.env.example` para `.env.local` e preencha:
```
NEXT_PUBLIC_SUPABASE_URL=sua_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_key
```
2. Instale e rode:
```bash
npm install
npm run dev
```

## Funcionalidades
- Criar empréstimo: `criarEmprestimo` em `app/actions.ts` calcula `valor_parcela = valor_total*(1+juros/100)/qtd` e gera datas +1 mês
- Marcar como pago: `marcarComoPago` atualiza `status='Pago'` e `data_pagamento=hoje`
- Dashboard `app/page.tsx` lista parcelas `Pendente` divididas em **A Vencer** (`data >= hoje`) e **Atrasadas** (`data < hoje`) com `X dias de atraso` em vermelho
- Modal para novo empréstimo, botão “Marcar como pago” por parcela
- Layout mobile-first responsivo

## Deploy
- GitHub: https://github.com/vicktordarosa07-source/controle-emprestimos
- Vercel: configurado via `vercel --prod` com envs do Supabase

## Estrutura alvo
- `app/page.tsx` — dashboard
- `app/actions.ts` — server actions
- `lib/supabase.ts` — client Supabase
- `package.json` — Next.js + Supabase
