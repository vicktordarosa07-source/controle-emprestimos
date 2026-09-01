-- Execute este arquivo no SQL Editor do Supabase antes de publicar a versao com login.
-- 1. Crie o usuario dono pelo Auth do Supabase.
-- 2. Copie o id do usuario em Authentication > Users.
-- 3. Substitua OWNER_USER_ID abaixo e rode o arquivo inteiro.

alter table public.clientes
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists endereco text not null default '',
  add column if not exists telefone text not null default '',
  add column if not exists cpf text not null default '';

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  fone text not null,
  status text not null default 'pending',
  is_admin boolean not null default false,
  is_dev boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_status_check check (status in ('pending', 'approved', 'blocked')),
  constraint profiles_email_format_check check (position('@' in email) > 1),
  constraint profiles_fone_length_check check (
    char_length(regexp_replace(fone, '[^0-9]', '', 'g')) between 10 and 15
  )
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

alter table public.profiles
  add column if not exists is_dev boolean not null default false;

create table if not exists public.signup_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint signup_invites_email_format_check check (position('@' in email) > 1)
);

alter table public.signup_invites enable row level security;

revoke all on table public.signup_invites from anon;
revoke all on table public.signup_invites from authenticated;
grant select, insert, update on table public.signup_invites to authenticated;

create index if not exists signup_invites_email_idx on public.signup_invites (lower(email));
create index if not exists signup_invites_created_by_idx on public.signup_invites (created_by);

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
  );
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
      and p.is_admin = true
  );
$$;

create or replace function public.is_dev_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
      and p.is_dev = true
  );
$$;

drop policy if exists "signup invites por dev" on public.signup_invites;
create policy "signup invites por dev"
on public.signup_invites
for all
to authenticated
using (public.is_dev_user())
with check (public.is_dev_user() and created_by = (select auth.uid()));

create or replace function public.get_signup_invite(p_invite_token text)
returns table(invite_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select si.email
  from public.signup_invites si
  where si.token_hash = encode(extensions.digest(coalesce(p_invite_token, ''), 'sha256'), 'hex')
    and si.used_at is null
  limit 1;
$$;

create or replace function public.create_signup_invite(
  p_email text,
  p_invite_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_dev_user() then
    raise exception 'Apenas usuario dev pode gerar convite.';
  end if;

  if position('@' in v_email) <= 1 then
    raise exception 'E-mail invalido.';
  end if;

  if coalesce(p_invite_token, '') = '' then
    raise exception 'Token de convite invalido.';
  end if;

  insert into public.signup_invites (email, token_hash, created_by)
  values (v_email, encode(extensions.digest(p_invite_token, 'sha256'), 'hex'), (select auth.uid()))
  returning id into v_id;

  return v_id;
end;
$$;

drop policy if exists "profiles por usuario" on public.profiles;
drop policy if exists "profiles select por usuario ou admin" on public.profiles;
create policy "profiles select por usuario ou admin"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) or public.is_admin_user());

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite record;
  v_invite_token text := coalesce(new.raw_user_meta_data ->> 'invite_token', '');
  v_email text := lower(coalesce(new.email, ''));
begin
  if v_invite_token = '' then
    raise exception 'Convite obrigatorio para cadastro.';
  end if;

  select si.id, si.email
  into v_invite
  from public.signup_invites si
  where si.token_hash = encode(extensions.digest(v_invite_token, 'sha256'), 'hex')
    and si.used_at is null
  for update;

  if not found then
    raise exception 'Convite invalido ou ja utilizado.';
  end if;

  if lower(v_invite.email) <> v_email then
    raise exception 'Este convite pertence a outro e-mail.';
  end if;

  update public.signup_invites
  set used_at = now(),
      used_by = new.id
  where id = v_invite.id;

  insert into public.profiles (id, email, fone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'fone', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      fone = excluded.fone,
      updated_at = now();

  return new;
end;
$$;

revoke all on function public.handle_new_user_profile() from public;
revoke all on function public.handle_new_user_profile() from anon;
revoke all on function public.handle_new_user_profile() from authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.handle_user_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = coalesce(new.email, email),
      fone = coalesce(new.raw_user_meta_data ->> 'fone', fone),
      updated_at = now()
  where id = new.id;

  return new;
end;
$$;

revoke all on function public.handle_user_profile_update() from public;
revoke all on function public.handle_user_profile_update() from anon;
revoke all on function public.handle_user_profile_update() from authenticated;

drop trigger if exists on_auth_user_updated_profile on auth.users;
create trigger on_auth_user_updated_profile
after update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_user_profile_update();

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
  );
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'approved'
      and p.is_admin = true
  );
$$;

create or replace function public.approve_user_access(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user() then
    raise exception 'Apenas administradores podem aprovar usuarios.';
  end if;

  update public.profiles
  set status = 'approved',
      approved_at = now(),
      approved_by = (select auth.uid()),
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Usuario nao encontrado.';
  end if;
end;
$$;

create or replace function public.update_own_profile_contact(p_fone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_fone, ''), '[^0-9]', '', 'g');
begin
  if (select auth.uid()) is null then
    raise exception 'Sessao expirada.';
  end if;

  if char_length(v_digits) < 10 or char_length(v_digits) > 15 then
    raise exception 'Telefone deve ter DDD e entre 10 e 15 digitos.';
  end if;

  update public.profiles
  set fone = trim(p_fone),
      updated_at = now()
  where id = (select auth.uid());

  if not found then
    raise exception 'Perfil nao encontrado.';
  end if;
end;
$$;

revoke all on function public.is_approved_user() from public;
revoke all on function public.is_approved_user() from anon;
grant execute on function public.is_approved_user() to authenticated;

revoke all on function public.is_admin_user() from public;
revoke all on function public.is_admin_user() from anon;
grant execute on function public.is_admin_user() to authenticated;

revoke all on function public.is_dev_user() from public;
revoke all on function public.is_dev_user() from anon;
grant execute on function public.is_dev_user() to authenticated;

revoke all on function public.get_signup_invite(text) from public;
grant execute on function public.get_signup_invite(text) to anon;
grant execute on function public.get_signup_invite(text) to authenticated;

revoke all on function public.create_signup_invite(text, text) from public;
revoke all on function public.create_signup_invite(text, text) from anon;
grant execute on function public.create_signup_invite(text, text) to authenticated;

revoke all on function public.approve_user_access(uuid) from public;
revoke all on function public.approve_user_access(uuid) from anon;
grant execute on function public.approve_user_access(uuid) to authenticated;

revoke all on function public.update_own_profile_contact(text) from public;
revoke all on function public.update_own_profile_contact(text) from anon;
grant execute on function public.update_own_profile_contact(text) to authenticated;

-- Backfill dos dados ja existentes para o dono atual.
-- update public.clientes
-- set user_id = 'OWNER_USER_ID'
-- where user_id is null;

alter table public.clientes
  alter column user_id set not null;

alter table public.emprestimos
  alter column cliente_id set not null,
  add column if not exists periodicidade_vencimento text not null default 'mensal',
  add column if not exists intervalo_personalizado_dias integer,
  add column if not exists juros_atraso_tipo text not null default 'percentual',
  add column if not exists juros_atraso_valor numeric not null default 0,
  add constraint emprestimos_valor_total_positive check (valor_total > 0),
  add constraint emprestimos_juros_non_negative check (juros_percentual >= 0),
  add constraint emprestimos_juros_atraso_tipo_check check (juros_atraso_tipo in ('valor', 'percentual')),
  add constraint emprestimos_juros_atraso_valor_check check (juros_atraso_valor >= 0),
  add constraint emprestimos_qtd_parcelas_range check (qtd_parcelas between 1 and 120),
  add constraint emprestimos_periodicidade_check check (
    periodicidade_vencimento in ('semanal', 'quinzenal', 'mensal', 'personalizado')
  ),
  add constraint emprestimos_intervalo_personalizado_check check (
    (
      periodicidade_vencimento = 'personalizado'
      and intervalo_personalizado_dias between 1 and 365
    )
    or (
      periodicidade_vencimento <> 'personalizado'
      and intervalo_personalizado_dias is null
    )
  );

alter table public.parcelas
  add column if not exists valor_pago numeric not null default 0,
  add column if not exists valor_juros_atraso_pago numeric not null default 0;

alter table public.parcelas
  alter column emprestimo_id set not null,
  add constraint parcelas_valor_positive check (valor > 0),
  add constraint parcelas_valor_pago_range check (valor_pago >= 0 and valor_pago <= valor),
  add constraint parcelas_valor_juros_atraso_pago_non_negative check (valor_juros_atraso_pago >= 0),
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
using (user_id = (select auth.uid()) and public.is_approved_user())
with check (user_id = (select auth.uid()) and public.is_approved_user());

drop policy if exists "emprestimos por usuario" on public.emprestimos;
create policy "emprestimos por usuario"
on public.emprestimos
for all
to authenticated
using (
  public.is_approved_user()
  and
  exists (
    select 1
    from public.clientes c
    where c.id = emprestimos.cliente_id
      and c.user_id = (select auth.uid())
  )
)
with check (
  public.is_approved_user()
  and
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
  public.is_approved_user()
  and
  exists (
    select 1
    from public.emprestimos e
    join public.clientes c on c.id = e.cliente_id
    where e.id = parcelas.emprestimo_id
      and c.user_id = (select auth.uid())
  )
)
with check (
  public.is_approved_user()
  and
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
  v_juros_pago_atual_centavos bigint;
  v_saldo_parcela_centavos bigint;
  v_juros_calculado_centavos bigint;
  v_juros_pendente_centavos bigint;
  v_dias_atraso integer;
  v_aplicado_centavos bigint;
  v_novo_pago_centavos bigint;
  v_novo_juros_pago_centavos bigint;
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

  select coalesce(sum(
    greatest(round((p.valor - p.valor_pago) * 100)::bigint, 0)
    +
    greatest(
      (
        case
          when v_hoje > p.data_vencimento
            and (p.valor - p.valor_pago) > 0
            and coalesce(e.juros_atraso_valor, 0) > 0
          then
            case coalesce(e.juros_atraso_tipo, 'percentual')
              when 'valor' then round(e.juros_atraso_valor * (v_hoje - p.data_vencimento) * 100)::bigint
              else round((p.valor - p.valor_pago) * (e.juros_atraso_valor / 100) * (v_hoje - p.data_vencimento) * 100)::bigint
            end
          else 0
        end
      )
      - round(coalesce(p.valor_juros_atraso_pago, 0) * 100)::bigint,
      0
    )
  ), 0)
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
    select
      p.id,
      p.valor,
      p.valor_pago,
      p.valor_juros_atraso_pago,
      p.data_vencimento,
      e.juros_atraso_tipo,
      e.juros_atraso_valor
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
    v_juros_pago_atual_centavos := round(coalesce(v_parcela.valor_juros_atraso_pago, 0) * 100)::bigint;
    v_saldo_parcela_centavos := greatest(v_valor_centavos - v_pago_atual_centavos, 0);
    v_dias_atraso := greatest(v_hoje - v_parcela.data_vencimento, 0);

    if v_dias_atraso > 0 and v_saldo_parcela_centavos > 0 and coalesce(v_parcela.juros_atraso_valor, 0) > 0 then
      if coalesce(v_parcela.juros_atraso_tipo, 'percentual') = 'valor' then
        v_juros_calculado_centavos := round(v_parcela.juros_atraso_valor * v_dias_atraso * 100)::bigint;
      else
        v_juros_calculado_centavos := round((v_saldo_parcela_centavos / 100.0) * (v_parcela.juros_atraso_valor / 100) * v_dias_atraso * 100)::bigint;
      end if;
    else
      v_juros_calculado_centavos := 0;
    end if;

    v_juros_pendente_centavos := greatest(v_juros_calculado_centavos - v_juros_pago_atual_centavos, 0);

    if v_saldo_parcela_centavos <= 0 and v_juros_pendente_centavos <= 0 then
      continue;
    end if;

    v_aplicado_centavos := least(v_restante_centavos, v_juros_pendente_centavos);
    v_novo_juros_pago_centavos := v_juros_pago_atual_centavos + v_aplicado_centavos;
    v_restante_centavos := v_restante_centavos - v_aplicado_centavos;

    v_aplicado_centavos := least(v_restante_centavos, v_saldo_parcela_centavos);
    v_novo_pago_centavos := v_pago_atual_centavos + v_aplicado_centavos;

    update public.parcelas
    set valor_pago = v_novo_pago_centavos / 100.0,
        valor_juros_atraso_pago = v_novo_juros_pago_centavos / 100.0,
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
