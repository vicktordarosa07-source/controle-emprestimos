# Gestão de Empréstimo

Sistema web privado para controle de emprestimos, parcelas, vencimentos e pagamentos.

**Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS e Supabase.

## Funcionalidades

- Login com Supabase Auth.
- Dashboard financeiro com total a receber, atrasado, a vencer e recebido.
- Busca por cliente e filtros por parcelas abertas, atrasadas, pagas ou todas.
- Criacao de emprestimo com validacao server-side.
- Geracao de parcelas com arredondamento em centavos e datas mensais sem pular mes.
- Confirmacao antes de marcar pagamento.
- Desfazer pagamento de parcela paga.
- RLS recomendado para isolar dados por usuario no Supabase.

## Configuracao local

1. Copie `.env.example` para `.env.local`.
2. Preencha as variaveis:

```bash
NEXT_PUBLIC_SUPABASE_URL=sua_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key
```

3. Instale e rode:

```bash
npm install
npm run dev
```

## Supabase

Antes de publicar a versao com login, execute `supabase-production.sql` no SQL Editor do Supabase.

Passos obrigatorios:

1. Ative Email/Password em Authentication > Providers.
2. Desative a confirmacao obrigatoria em Authentication > Providers > Email se quiser entrar sem confirmar e-mail.
3. Crie o usuario dono em Authentication > Users.
4. Copie o `id` desse usuario.
5. No arquivo `supabase-production.sql`, substitua `OWNER_USER_ID` no comando de backfill.
6. Remova o comentario do comando `update public.clientes`.
7. Execute o SQL inteiro.

Sem essa migracao, a versao nova pode falhar ao criar clientes porque o app grava `clientes.user_id`.

## Comandos

```bash
npm run dev
npm run build
npm run lint
npm audit --omit=dev
```

## Deploy

Configure as mesmas variaveis no Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Depois de aplicar a migracao e configurar as variaveis, publique normalmente na Vercel.
