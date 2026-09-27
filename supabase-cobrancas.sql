-- Migração aditiva para habilitar descrição nas cobranças.
-- Pode ser executada novamente sem sobrescrever dados existentes.
alter table public.emprestimos
  add column if not exists descricao text not null default '';
