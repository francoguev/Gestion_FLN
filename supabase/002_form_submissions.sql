-- Recepción privada de respuestas de Tally e importación histórica.
-- Ejecutar en Supabase SQL Editor antes de desplegar la Edge Function.

create table if not exists public.form_submissions (
  id bigint generated always as identity primary key,
  source text not null check (source in ('tally', 'google_sheet')),
  source_submission_id text not null,
  form_id text,
  submitted_at timestamptz,
  content_hash text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (source, source_submission_id)
);

create index if not exists form_submissions_submitted_at_idx
  on public.form_submissions (submitted_at desc);
create index if not exists form_submissions_form_id_idx
  on public.form_submissions (form_id);
create index if not exists form_submissions_content_hash_idx
  on public.form_submissions (content_hash);

alter table public.form_submissions enable row level security;

-- No se crean políticas para usuarios de la app: las inserciones las realiza
-- únicamente la Edge Function con credenciales de servidor. Así las respuestas
-- del formulario no quedan expuestas al navegador.
