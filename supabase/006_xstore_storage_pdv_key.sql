-- Normaliza el nombre del PDV tanto en el perfil como en la ruta del archivo.
-- Evita que tildes o la Ñ impidan que un asesor cargue su evidencia.

create or replace function public.xstore_pdv_storage_key(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '_' from regexp_replace(
    lower(translate(coalesce(p_value, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
    '[^a-z0-9]+', '_', 'g'
  ));
$$;

create or replace function public.xstore_can_upload_path(p_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select split_part(coalesce(p_name, ''), '/', 1) = 'pdv'
     and case
       when public.xstore_current_cargo() = 'asesor' then
         public.xstore_pdv_storage_key(public.xstore_current_pdv()) =
         public.xstore_pdv_storage_key(split_part(coalesce(p_name, ''), '/', 2))
       else public.xstore_current_cargo() in ('operaciones', 'supervisor', 'gerente')
     end;
$$;

grant execute on function public.xstore_pdv_storage_key(text) to authenticated;
grant execute on function public.xstore_can_upload_path(text) to authenticated;
