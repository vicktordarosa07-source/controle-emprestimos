-- Recursos operacionais: pagamentos auditáveis, contatos e lixeira recuperável.
-- A migração é aditiva: não apaga nem reescreve os dados financeiros já existentes.

alter table public.clientes
  add column if not exists deleted_at timestamptz;

alter table public.emprestimos
  add column if not exists deleted_at timestamptz;

create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  valor_total numeric(12,2) not null check (valor_total > 0),
  tipo text not null default 'recebimento' check (tipo in ('recebimento', 'estorno')),
  referencia_pagamento_id uuid references public.pagamentos(id) on delete set null,
  recebido_em date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.pagamento_itens (
  id uuid primary key default gen_random_uuid(),
  pagamento_id uuid not null references public.pagamentos(id) on delete cascade,
  parcela_id uuid not null references public.parcelas(id) on delete cascade,
  valor_principal numeric(12,2) not null default 0 check (valor_principal >= 0),
  valor_juros numeric(12,2) not null default 0 check (valor_juros >= 0),
  created_at timestamptz not null default now(),
  constraint pagamento_itens_valor_positive check (valor_principal + valor_juros > 0)
);

create table if not exists public.cobranca_contatos (
  id uuid primary key default gen_random_uuid(),
  parcela_id uuid not null references public.parcelas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  canal text not null default 'manual' check (canal in ('manual', 'telefone', 'presencial', 'outro')),
  observacao text not null default '',
  realizado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists pagamentos_cliente_data_idx
  on public.pagamentos (cliente_id, recebido_em desc);
create index if not exists pagamento_itens_parcela_idx
  on public.pagamento_itens (parcela_id);
create index if not exists cobranca_contatos_parcela_data_idx
  on public.cobranca_contatos (parcela_id, realizado_em desc);
create index if not exists emprestimos_deleted_at_idx
  on public.emprestimos (deleted_at) where deleted_at is not null;
create index if not exists clientes_deleted_at_idx
  on public.clientes (deleted_at) where deleted_at is not null;

alter table public.pagamentos enable row level security;
alter table public.pagamento_itens enable row level security;
alter table public.cobranca_contatos enable row level security;

drop policy if exists "pagamentos do proprio usuario" on public.pagamentos;
create policy "pagamentos do proprio usuario"
on public.pagamentos for all to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.clientes c
    where c.id = cliente_id and c.user_id = (select auth.uid())
  )
);

drop policy if exists "itens de pagamentos do proprio usuario" on public.pagamento_itens;
create policy "itens de pagamentos do proprio usuario"
on public.pagamento_itens for all to authenticated
using (exists (
  select 1 from public.pagamentos p
  where p.id = pagamento_id and p.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.pagamentos pg
  join public.parcelas pa on pa.id = parcela_id
  join public.emprestimos e on e.id = pa.emprestimo_id
  join public.clientes c on c.id = e.cliente_id
  where pg.id = pagamento_id
    and pg.user_id = (select auth.uid())
    and c.user_id = (select auth.uid())
    and pg.cliente_id = c.id
));

drop policy if exists "contatos das proprias cobrancas" on public.cobranca_contatos;
create policy "contatos das proprias cobrancas"
on public.cobranca_contatos for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.parcelas p
  join public.emprestimos e on e.id = p.emprestimo_id
  join public.clientes c on c.id = e.cliente_id
  where p.id = parcela_id and c.user_id = (select auth.uid())
))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.parcelas p
  join public.emprestimos e on e.id = p.emprestimo_id
  join public.clientes c on c.id = e.cliente_id
  where p.id = parcela_id and c.user_id = (select auth.uid())
));

grant select, insert, update, delete on public.pagamentos to authenticated;
grant select, insert, update, delete on public.pagamento_itens to authenticated;
grant select, insert, update, delete on public.cobranca_contatos to authenticated;

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
  v_juros_pago_atual_centavos bigint;
  v_saldo_parcela_centavos bigint;
  v_juros_calculado_centavos bigint;
  v_juros_pendente_centavos bigint;
  v_dias_atraso integer;
  v_aplicado_centavos bigint;
  v_juros_aplicado_centavos bigint;
  v_principal_aplicado_centavos bigint;
  v_novo_pago_centavos bigint;
  v_novo_juros_pago_centavos bigint;
  v_pagamento_id uuid;
begin
  if p_valor_pago is null or p_valor_pago <= 0 then
    raise exception 'Valor pago deve ser maior que zero.';
  end if;
  if not exists (
    select 1 from public.clientes c
    where c.id = p_cliente_id and c.user_id = (select auth.uid())
  ) then
    raise exception 'Cliente nao encontrado para este usuario.';
  end if;

  v_restante_centavos := round(p_valor_pago * 100)::bigint;
  if v_restante_centavos <= 0 then
    raise exception 'O valor pago deve ser de pelo menos um centavo.';
  end if;
  select coalesce(sum(
    greatest(round((p.valor - p.valor_pago) * 100)::bigint, 0)
    + greatest((case
        when v_hoje > p.data_vencimento and (p.valor - p.valor_pago) > 0
          and coalesce(e.juros_atraso_valor, 0) > 0
        then case coalesce(e.juros_atraso_tipo, 'percentual')
          when 'valor' then round(e.juros_atraso_valor * (v_hoje - p.data_vencimento) * 100)::bigint
          else round((p.valor - p.valor_pago) * (e.juros_atraso_valor / 100)
            * (v_hoje - p.data_vencimento) * 100)::bigint
        end else 0 end) - round(coalesce(p.valor_juros_atraso_pago, 0) * 100)::bigint, 0)
  ), 0) into v_saldo_total_centavos
  from public.parcelas p
  join public.emprestimos e on e.id = p.emprestimo_id
  join public.clientes c on c.id = e.cliente_id
  where c.id = p_cliente_id and c.user_id = (select auth.uid())
    and e.deleted_at is null and c.deleted_at is null and p.status <> 'Pago';

  if v_saldo_total_centavos <= 0 then raise exception 'Este cliente nao possui saldo em aberto.'; end if;
  if v_restante_centavos > v_saldo_total_centavos then raise exception 'Valor pago maior que o saldo em aberto.'; end if;

  insert into public.pagamentos (cliente_id, user_id, valor_total, recebido_em)
  values (p_cliente_id, (select auth.uid()), v_restante_centavos / 100.0, v_hoje)
  returning id into v_pagamento_id;

  for v_parcela in
    select p.id, p.valor, p.valor_pago, p.valor_juros_atraso_pago, p.data_vencimento,
      e.juros_atraso_tipo, e.juros_atraso_valor
    from public.parcelas p
    join public.emprestimos e on e.id = p.emprestimo_id
    join public.clientes c on c.id = e.cliente_id
    where c.id = p_cliente_id and c.user_id = (select auth.uid())
      and e.deleted_at is null and c.deleted_at is null and p.status <> 'Pago'
    order by p.data_vencimento asc, p.numero asc
    for update of p
  loop
    exit when v_restante_centavos <= 0;
    v_valor_centavos := round(v_parcela.valor * 100)::bigint;
    v_pago_atual_centavos := round(coalesce(v_parcela.valor_pago, 0) * 100)::bigint;
    v_juros_pago_atual_centavos := round(coalesce(v_parcela.valor_juros_atraso_pago, 0) * 100)::bigint;
    v_saldo_parcela_centavos := greatest(v_valor_centavos - v_pago_atual_centavos, 0);
    v_dias_atraso := greatest(v_hoje - v_parcela.data_vencimento, 0);
    if v_dias_atraso > 0 and v_saldo_parcela_centavos > 0 and coalesce(v_parcela.juros_atraso_valor, 0) > 0 then
      if coalesce(v_parcela.juros_atraso_tipo, 'percentual') = 'valor' then
        v_juros_calculado_centavos := round(v_parcela.juros_atraso_valor * v_dias_atraso * 100)::bigint;
      else
        v_juros_calculado_centavos := round((v_saldo_parcela_centavos / 100.0)
          * (v_parcela.juros_atraso_valor / 100) * v_dias_atraso * 100)::bigint;
      end if;
    else v_juros_calculado_centavos := 0; end if;

    v_juros_pendente_centavos := greatest(v_juros_calculado_centavos - v_juros_pago_atual_centavos, 0);
    if v_saldo_parcela_centavos <= 0 and v_juros_pendente_centavos <= 0 then continue; end if;
    v_juros_aplicado_centavos := least(v_restante_centavos, v_juros_pendente_centavos);
    v_novo_juros_pago_centavos := v_juros_pago_atual_centavos + v_juros_aplicado_centavos;
    v_restante_centavos := v_restante_centavos - v_juros_aplicado_centavos;
    v_principal_aplicado_centavos := least(v_restante_centavos, v_saldo_parcela_centavos);
    v_novo_pago_centavos := v_pago_atual_centavos + v_principal_aplicado_centavos;
    if v_juros_aplicado_centavos + v_principal_aplicado_centavos > 0 then
      insert into public.pagamento_itens (pagamento_id, parcela_id, valor_principal, valor_juros)
      values (v_pagamento_id, v_parcela.id, v_principal_aplicado_centavos / 100.0, v_juros_aplicado_centavos / 100.0);
    end if;
    update public.parcelas
    set valor_pago = v_novo_pago_centavos / 100.0,
      valor_juros_atraso_pago = v_novo_juros_pago_centavos / 100.0,
      status = case when v_novo_pago_centavos >= v_valor_centavos then 'Pago' else 'Pendente' end,
      data_pagamento = case when v_novo_pago_centavos >= v_valor_centavos then v_hoje else null end
    where id = v_parcela.id;
    v_restante_centavos := v_restante_centavos - v_principal_aplicado_centavos;
  end loop;
end;
$$;

create or replace function public.registrar_pagamento_parcela(p_parcela_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_parcela record;
  v_juros numeric(12,2);
  v_total numeric(12,2);
  v_pagamento_id uuid;
  v_hoje date := current_date;
begin
  select p.id, p.valor, p.valor_pago, p.valor_juros_atraso_pago, p.data_vencimento,
    p.status, p.emprestimo_id, e.cliente_id, e.juros_atraso_tipo, e.juros_atraso_valor, c.user_id
  into v_parcela
  from public.parcelas p join public.emprestimos e on e.id = p.emprestimo_id
  join public.clientes c on c.id = e.cliente_id
  where p.id = p_parcela_id and c.user_id = (select auth.uid())
    and c.deleted_at is null and e.deleted_at is null for update of p;
  if not found or v_parcela.status = 'Pago' then raise exception 'Parcela indisponivel para pagamento.'; end if;
  v_juros := greatest(case when v_hoje > v_parcela.data_vencimento and (v_parcela.valor - coalesce(v_parcela.valor_pago, 0)) > 0
      then case coalesce(v_parcela.juros_atraso_tipo, 'percentual')
        when 'valor' then coalesce(v_parcela.juros_atraso_valor, 0) * (v_hoje - v_parcela.data_vencimento)
        else (v_parcela.valor - coalesce(v_parcela.valor_pago, 0)) * (coalesce(v_parcela.juros_atraso_valor, 0) / 100)
          * (v_hoje - v_parcela.data_vencimento) end else 0 end
    - coalesce(v_parcela.valor_juros_atraso_pago, 0), 0);
  v_juros := round(v_juros, 2);
  v_total := greatest(v_parcela.valor - coalesce(v_parcela.valor_pago, 0), 0) + v_juros;
  if v_total <= 0 then raise exception 'Parcela sem saldo para pagamento.'; end if;
  insert into public.pagamentos (cliente_id, user_id, valor_total, recebido_em)
  values (v_parcela.cliente_id, (select auth.uid()), v_total, v_hoje) returning id into v_pagamento_id;
  insert into public.pagamento_itens (pagamento_id, parcela_id, valor_principal, valor_juros)
  values (v_pagamento_id, p_parcela_id, v_total - v_juros, v_juros);
  update public.parcelas set status = 'Pago', data_pagamento = v_hoje,
    valor_pago = valor, valor_juros_atraso_pago = coalesce(valor_juros_atraso_pago, 0) + v_juros
  where id = p_parcela_id;
end; $$;

create or replace function public.reabrir_parcela(p_parcela_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_item record; v_estorno_id uuid; v_valor numeric(12,2); begin
  if not exists (
    select 1 from public.parcelas p join public.emprestimos e on e.id = p.emprestimo_id
    join public.clientes c on c.id = e.cliente_id
    where p.id = p_parcela_id and p.status = 'Pago' and c.user_id = (select auth.uid())
  ) then raise exception 'Parcela paga nao encontrada.'; end if;
  for v_item in
    select i.id, i.pagamento_id, i.valor_principal, i.valor_juros,
      pg.cliente_id, pg.user_id
    from public.pagamento_itens i
    join public.pagamentos pg on pg.id = i.pagamento_id
    where i.parcela_id = p_parcela_id and pg.tipo = 'recebimento'
      and not exists (
        select 1 from public.pagamentos est
        join public.pagamento_itens est_item on est_item.pagamento_id = est.id
        where est.tipo = 'estorno' and est.referencia_pagamento_id = pg.id
          and est_item.parcela_id = p_parcela_id
      )
    order by i.created_at desc for update of i
  loop
    v_valor := v_item.valor_principal + v_item.valor_juros;
    if v_valor > 0 then
      insert into public.pagamentos (cliente_id, user_id, valor_total, tipo, referencia_pagamento_id, recebido_em)
      values (v_item.cliente_id, v_item.user_id, v_valor, 'estorno', v_item.pagamento_id, current_date)
      returning id into v_estorno_id;
      insert into public.pagamento_itens (pagamento_id, parcela_id, valor_principal, valor_juros)
      values (v_estorno_id, p_parcela_id, v_item.valor_principal, v_item.valor_juros);
    end if;
  end loop;
  update public.parcelas set status = 'Pendente', data_pagamento = null,
    valor_pago = 0, valor_juros_atraso_pago = 0 where id = p_parcela_id;
end; $$;

create or replace function public.registrar_contato_cobranca(
  p_parcela_id uuid, p_canal text default 'manual', p_observacao text default ''
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; begin
  if p_canal not in ('manual', 'telefone', 'presencial', 'outro') then raise exception 'Canal inválido.'; end if;
  insert into public.cobranca_contatos (parcela_id, user_id, canal, observacao)
  select p_parcela_id, (select auth.uid()), p_canal, left(coalesce(p_observacao, ''), 500)
  from public.parcelas p join public.emprestimos e on e.id = p.emprestimo_id
  join public.clientes c on c.id = e.cliente_id
  where p.id = p_parcela_id and c.user_id = (select auth.uid()) and p.status <> 'Pago'
    and e.deleted_at is null and c.deleted_at is null
  returning id into v_id;
  if v_id is null then raise exception 'Cobrança em aberto não encontrada.'; end if;
  return v_id;
end; $$;

create or replace function public.arquivar_cobranca(p_emprestimo_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.emprestimos e set deleted_at = now()
  where e.id = p_emprestimo_id and exists (
    select 1 from public.clientes c where c.id = e.cliente_id and c.user_id = (select auth.uid())
  );
  if not found then raise exception 'Cobrança não encontrada.'; end if;
end; $$;

create or replace function public.restaurar_cobranca(p_emprestimo_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.emprestimos e set deleted_at = null
  where e.id = p_emprestimo_id and exists (
    select 1 from public.clientes c where c.id = e.cliente_id and c.user_id = (select auth.uid())
  );
  if not found then raise exception 'Cobrança arquivada não encontrada.'; end if;
end; $$;

revoke all on function public.registrar_pagamento_parcela(uuid) from public, anon;
revoke all on function public.reabrir_parcela(uuid) from public, anon;
revoke all on function public.registrar_contato_cobranca(uuid, text, text) from public, anon;
revoke all on function public.arquivar_cobranca(uuid) from public, anon;
revoke all on function public.restaurar_cobranca(uuid) from public, anon;
grant execute on function public.registrar_pagamento_parcela(uuid) to authenticated;
grant execute on function public.reabrir_parcela(uuid) to authenticated;
grant execute on function public.registrar_contato_cobranca(uuid, text, text) to authenticated;
grant execute on function public.arquivar_cobranca(uuid) to authenticated;
grant execute on function public.restaurar_cobranca(uuid) to authenticated;
