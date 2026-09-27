-- Libera cadastros sem convite e aprova automaticamente novos perfis.
-- Contas bloqueadas e papéis de admin/desenvolvedor não são alterados.

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, fone, status, approved_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'fone', ''),
    'approved',
    now()
  )
  on conflict (id) do update
  set email = excluded.email,
      fone = excluded.fone,
      updated_at = now();

  return new;
end;
$$;

-- Libera cadastros anteriores que aguardavam aprovação; bloqueios permanecem.
update public.profiles
set status = 'approved',
    approved_at = coalesce(approved_at, now()),
    updated_at = now()
where status = 'pending';
