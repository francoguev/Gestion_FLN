-- Pulso: políticas mínimas de acceso
-- Revísalo en un entorno de prueba antes de ejecutarlo en Supabase.
-- Supone que profiles tiene: email, cargo, pdv.
-- Supone que cuota_ajustes tiene: pdv, mes, nombre.

create or replace function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and lower(trim(coalesce(cargo, ''))) = 'supervisor'
  );
$$;

revoke all on function public.is_supervisor() from public;
grant execute on function public.is_supervisor() to authenticated;

alter table public.profiles enable row level security;
alter table public.novedades enable row level security;
alter table public.cuota_ajustes enable row level security;

-- Profiles: cada persona solo puede leer su propio perfil desde la app.
-- La política existente detectada en el proyecto permite leer todos los
-- perfiles (using true); se elimina para que no prevalezca por combinación OR.
drop policy if exists "authenticated_can_read_profiles" on public.profiles;
drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own"
on public.profiles for select to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Novedades: todo usuario autenticado puede leer; solo Operaciones publica o modifica.
drop policy if exists "novedades_read_authenticated" on public.novedades;
create policy "novedades_read_authenticated"
on public.novedades for select to authenticated
using (true);

drop policy if exists "novedades_manage_operaciones" on public.novedades;
create policy "novedades_manage_operaciones"
on public.novedades for all to authenticated
using (public.is_operaciones())
with check (public.is_operaciones());

-- Ajustes de cuota: cualquier usuario autenticado puede consultarlos para
-- calcular el avance; solo el cargo Supervisor puede crearlos, modificarlos
-- o eliminarlos.
-- Se elimina la política actual detectada, que da acceso total (using true /
-- with check true) a cualquier usuario autenticado.
drop policy if exists "authenticated_can_read_write_ajustes" on public.cuota_ajustes;
drop policy if exists "cuota_ajustes_by_pdv" on public.cuota_ajustes;
drop policy if exists "cuota_ajustes_read_authenticated" on public.cuota_ajustes;
drop policy if exists "cuota_ajustes_manage_supervisor" on public.cuota_ajustes;
create policy "cuota_ajustes_read_authenticated"
on public.cuota_ajustes for select to authenticated
using (true);
create policy "cuota_ajustes_manage_supervisor"
on public.cuota_ajustes for all to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

-- Storage (bucket novedades): ejecutar solo después de adaptar la app para
-- usar URL firmadas en vez de getPublicUrl(). Mantener el bucket privado.
-- update storage.buckets set public = false where id = 'novedades';
-- create policy "novedades_files_read_authenticated" on storage.objects for select
--   to authenticated using (bucket_id = 'novedades');
-- create policy "novedades_files_upload_operaciones" on storage.objects for insert
--   to authenticated with check (bucket_id = 'novedades' and public.is_operaciones());
-- create policy "novedades_files_update_operaciones" on storage.objects for update
--   to authenticated using (bucket_id = 'novedades' and public.is_operaciones())
--   with check (bucket_id = 'novedades' and public.is_operaciones());
-- create policy "novedades_files_delete_operaciones" on storage.objects for delete
--   to authenticated using (bucket_id = 'novedades' and public.is_operaciones());
