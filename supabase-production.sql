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
  add column if not exists valor_pago numeric not null default 0;

alter table public.parcelas
  alter column emprestimo_id set not null,
  add constraint parcelas_valor_positive check (valor > 0),
  add constraint parcelas_valor_pago_range check (valor_pago >= 0 and valor_pago <= valor),
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

revoke all on table public.clientes from anon;
revoke all on table public.emprestimos from anon;
revoke all on table public.parcelas from anon;

revoke truncate, trigger, references on table public.clientes from authenticated;
revoke truncate, trigger, references on table public.emprestimos from authenticated;
revoke truncate, trigger, references on table public.parcelas from authenticated;

grant select, insert, update, delete on table public.clientes to authenticated;
grant select, insert, update, delete on table public.emprestimos to authenticated;
grant select, insert, update, delete on table public.parcelas to authenticated;

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

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;

create or replace function public.registrar_pagamento_cliente(
  p_cliente_id uuid,
  p_valor_pago numeric
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_restante_centavos bigint;
  v_saldo_total_centavos bigint;
  v_hoje date := current_date;
  v_parcela record;
  v_valor_centavos bigint;
  v_pago_atual_centavos bigint;
  v_saldo_parcela_centavos bigint;
  v_aplicado_centavos bigint;
  v_novo_pago_centavos bigint;
begin
  if p_valor_pago is null or p_valor_pago <= 0 then
    raise exception 'Valor pago deve ser maior que zero.';
  end if;

  if not exists (
    select 1
    from public.clientes c
    where c.id = p_cliente_id
      and c.user_id = (select auth.uid())
  ) then
    raise exception 'Cliente nao encontrado para este usuario.';
  end if;

  v_restante_centavos := round(p_valor_pago * 100)::bigint;

  select coalesce(sum(greatest(round((p.valor - p.valor_pago) * 100)::bigint, 0)), 0)
  into v_saldo_total_centavos
  from public.parcelas p
  join public.emprestimos e on e.id = p.emprestimo_id
  join public.clientes c on c.id = e.cliente_id
  where c.id = p_cliente_id
    and c.user_id = (select auth.uid())
    and p.status <> 'Pago';

  if v_saldo_total_centavos <= 0 then
    raise exception 'Este cliente nao possui saldo em aberto.';
  end if;

  if v_restante_centavos > v_saldo_total_centavos then
    raise exception 'Valor pago maior que o saldo em aberto.';
  end if;

  for v_parcela in
    select p.id, p.valor, p.valor_pago
    from public.parcelas p
    join public.emprestimos e on e.id = p.emprestimo_id
    join public.clientes c on c.id = e.cliente_id
    where c.id = p_cliente_id
      and c.user_id = (select auth.uid())
      and p.status <> 'Pago'
    order by p.data_vencimento asc, p.numero asc
    for update of p
  loop
    exit when v_restante_centavos <= 0;

    v_valor_centavos := round(v_parcela.valor * 100)::bigint;
    v_pago_atual_centavos := round(coalesce(v_parcela.valor_pago, 0) * 100)::bigint;
    v_saldo_parcela_centavos := greatest(v_valor_centavos - v_pago_atual_centavos, 0);

    if v_saldo_parcela_centavos <= 0 then
      continue;
    end if;

    v_aplicado_centavos := least(v_restante_centavos, v_saldo_parcela_centavos);
    v_novo_pago_centavos := v_pago_atual_centavos + v_aplicado_centavos;

    update public.parcelas
    set valor_pago = v_novo_pago_centavos / 100.0,
        status = case when v_novo_pago_centavos >= v_valor_centavos then 'Pago' else 'Pendente' end,
        data_pagamento = case when v_novo_pago_centavos >= v_valor_centavos then v_hoje else null end
    where id = v_parcela.id;

    v_restante_centavos := v_restante_centavos - v_aplicado_centavos;
  end loop;
end;
$$;

revoke all on function public.registrar_pagamento_cliente(uuid, numeric) from public;
revoke all on function public.registrar_pagamento_cliente(uuid, numeric) from anon;
grant execute on function public.registrar_pagamento_cliente(uuid, numeric) to authenticated;
