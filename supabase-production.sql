-- Execute este arquivo no SQL Editor do Supabase antes de publicar a versao com login.
-- 1. Crie o usuario dono pelo Auth do Supabase.
-- 2. Copie o id do usuario em Authentication > Users.
-- 3. Substitua OWNER_USER_ID abaixo e rode o arquivo inteiro.

alter table public.clientes
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Backfill dos dados ja existentes para o dono atual.
-- update public.clientes
-- set user_id = 'OWNER_USER_ID'
-- where user_id is null;

alter table public.clientes
  alter column user_id set not null;

alter table public.emprestimos
  alter column cliente_id set not null,
  add constraint emprestimos_valor_total_positive check (valor_total > 0),
  add constraint emprestimos_juros_non_negative check (juros_percentual >= 0),
  add constraint emprestimos_qtd_parcelas_range check (qtd_parcelas between 1 and 120);

alter table public.parcelas
  alter column emprestimo_id set not null,
  add constraint parcelas_valor_positive check (valor > 0),
  add constraint parcelas_status_check check (status in ('Pendente', 'Pago')),
  add constraint parcelas_numero_positive check (numero > 0);

create unique index if not exists parcelas_emprestimo_numero_idx
  on public.parcelas (emprestimo_id, numero);

create index if not exists clientes_user_id_idx
  on public.clientes (user_id);

create index if not exists emprestimos_cliente_id_idx
  on public.emprestimos (cliente_id);

create index if not exists parcelas_status_vencimento_idx
  on public.parcelas (status, data_vencimento);

alter table public.clientes enable row level security;
alter table public.emprestimos enable row level security;
alter table public.parcelas enable row level security;

drop policy if exists "clientes por usuario" on public.clientes;
create policy "clientes por usuario"
on public.clientes
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "emprestimos por usuario" on public.emprestimos;
create policy "emprestimos por usuario"
on public.emprestimos
for all
to authenticated
using (
  exists (
    select 1
    from public.clientes c
    where c.id = emprestimos.cliente_id
      and c.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.clientes c
    where c.id = emprestimos.cliente_id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists "parcelas por usuario" on public.parcelas;
create policy "parcelas por usuario"
on public.parcelas
for all
to authenticated
using (
  exists (
    select 1
    from public.emprestimos e
    join public.clientes c on c.id = e.cliente_id
    where e.id = parcelas.emprestimo_id
      and c.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.emprestimos e
    join public.clientes c on c.id = e.cliente_id
    where e.id = parcelas.emprestimo_id
      and c.user_id = (select auth.uid())
  )
);
