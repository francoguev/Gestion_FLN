-- Pulso · Módulo de Stock: Migración 018 (Tabla SQL e Inserción Incremental de Stock)

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  serie text not null unique,
  sku text,
  descripcion text,
  modelo text,
  modelo_normalizado text,
  marca text,
  tipo text default 'EQUIPO',
  pdv_raw text,
  tex_normalizado text,
  almacen_tipo text default 'NUEVO',
  estado_stock text not null default 'DISPONIBLE',
  faltante_observacion text,
  fecha_ingreso date,
  fecha_carga date default current_date,
  fecha_venta date,
  registered_by_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_stock_items_estado_stock on public.stock_items(estado_stock);
create index if not exists idx_stock_items_tex_normalizado on public.stock_items(tex_normalizado);
create index if not exists idx_stock_items_marca on public.stock_items(marca);
create index if not exists idx_stock_items_tipo on public.stock_items(tipo);

-- Políticas RLS
alter table public.stock_items enable row level security;

drop policy if exists "Permitir lectura de stock a usuarios autenticados" on public.stock_items;
create policy "Permitir lectura de stock a usuarios autenticados"
  on public.stock_items for select to authenticated using (true);

drop policy if exists "Permitir gestion de stock a administradores u operaciones" on public.stock_items;
create policy "Permitir gestion de stock a administradores u operaciones"
  on public.stock_items for all to authenticated
  using (
    public.xstore_current_email() in (
      select email from public.profiles where es_administrador = true or lower(coalesce(cargo,'')) = 'operaciones'
    )
  );

-- Función RPC para procesamiento diferencial de stock
create or replace function public.xstore_process_stock_upload(
  p_fecha_carga date,
  p_fecha_venta_calculada date,
  p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.xstore_current_email();
  v_new_series text[];
  v_sold_count integer := 0;
  v_new_count integer := 0;
  v_total_disponibles integer := 0;
  v_total_faltantes integer := 0;
begin
  if not (
    select coalesce(es_administrador, false) or lower(coalesce(cargo,'')) = 'operaciones'
    from public.profiles where email = v_email
  ) then
    raise exception 'No tienes permisos de Administrador u Operaciones para cargar stock.';
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'El lote de stock está vacío.';
  end if;

  -- 1. Extraer todas las series recibidas en la carga de hoy
  select array_agg(distinct trim(item->>'serie'))
  into v_new_series
  from jsonb_array_elements(p_items) item
  where nullif(trim(item->>'serie'), '') is not null;

  -- 2. Marcar como VENDIDOS los equipos que estaban DISPONIBLE y ya no figuran en la carga de hoy
  with updated as (
    update public.stock_items
    set estado_stock = 'VENDIDO',
        fecha_venta = p_fecha_venta_calculada,
        updated_at = now()
    where estado_stock = 'DISPONIBLE'
      and not (serie = any(v_new_series))
    returning id
  )
  select count(*) into v_sold_count from updated;

  -- 3. Upsert (Insertar nuevos o actualizar continuos/faltantes)
  insert into public.stock_items (
    serie, sku, descripcion, modelo, modelo_normalizado, marca, tipo,
    pdv_raw, tex_normalizado, almacen_tipo, estado_stock, faltante_observacion,
    fecha_ingreso, fecha_carga, registered_by_email, updated_at
  )
  select
    trim(item->>'serie'),
    nullif(trim(item->>'sku'), ''),
    nullif(trim(item->>'descripcion'), ''),
    nullif(trim(item->>'modelo'), ''),
    nullif(trim(item->>'modelo_normalizado'), ''),
    nullif(trim(item->>'marca'), ''),
    coalesce(nullif(trim(item->>'tipo'), ''), 'EQUIPO'),
    nullif(trim(item->>'pdv_raw'), ''),
    nullif(trim(item->>'tex_normalizado'), ''),
    coalesce(nullif(trim(item->>'almacen_tipo'), ''), 'NUEVO'),
    coalesce(nullif(trim(item->>'estado_stock'), ''), 'DISPONIBLE'),
    nullif(trim(item->>'faltante_observacion'), ''),
    case when nullif(trim(item->>'fecha_ingreso'), '') is not null
         then (item->>'fecha_ingreso')::date
         else null end,
    p_fecha_carga,
    v_email,
    now()
  from jsonb_array_elements(p_items) item
  where nullif(trim(item->>'serie'), '') is not null
  on conflict (serie) do update set
    sku = excluded.sku,
    descripcion = excluded.descripcion,
    modelo = excluded.modelo,
    modelo_normalizado = excluded.modelo_normalizado,
    marca = excluded.marca,
    tipo = excluded.tipo,
    pdv_raw = excluded.pdv_raw,
    tex_normalizado = excluded.tex_normalizado,
    almacen_tipo = excluded.almacen_tipo,
    estado_stock = excluded.estado_stock,
    faltante_observacion = excluded.faltante_observacion,
    fecha_ingreso = coalesce(excluded.fecha_ingreso, stock_items.fecha_ingreso),
    fecha_carga = excluded.fecha_carga,
    fecha_venta = case when excluded.estado_stock = 'DISPONIBLE' then null else stock_items.fecha_venta end,
    updated_at = now();

  -- Conteos finales
  select count(*) into v_total_disponibles from public.stock_items where estado_stock = 'DISPONIBLE';
  select count(*) into v_total_faltantes from public.stock_items where estado_stock = 'FALTANTE';

  return jsonb_build_object(
    'success', true,
    'vendidos_count', v_sold_count,
    'disponibles_count', v_total_disponibles,
    'faltantes_count', v_total_faltantes
  );
end;
$$;

grant execute on function public.xstore_process_stock_upload(date, date, jsonb) to authenticated;
