-- Pulso · Gestión Xstore: Migración 011 (Eliminar registro de caja por Operaciones)
-- Permite a Operaciones eliminar un recaudo no conciliado y sus asignaciones de depósito asociadas.

create or replace function public.xstore_delete_closure(p_closure_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rec public.xstore_cash_closures;
  v_email text := public.xstore_current_email();
  v_dep_ids uuid[];
begin
  if not public.xstore_is_operations() then
    raise exception 'Solo Operaciones puede eliminar registros de recaudo.';
  end if;

  select * into v_rec from public.xstore_cash_closures
  where id = p_closure_id for update;

  if not found then
    raise exception 'No se encontró el registro a eliminar.';
  end if;

  if v_rec.status in ('validated', 'payjoy_validated', 'difference') then
    raise exception 'No se puede eliminar un registro que ya ha sido conciliado por Operaciones.';
  end if;

  -- Auditoría antes de eliminar
  perform public.xstore_add_audit(p_closure_id, 'caja_eliminada', jsonb_build_object(
    'pdv', v_rec.pdv,
    'cash_date', v_rec.cash_date,
    'monto', v_rec.cash_amount
  ));

  -- Obtener los IDs de depósito vinculados
  select array_agg(distinct deposit_id) into v_dep_ids
  from public.xstore_deposit_allocations
  where closure_id = p_closure_id;

  -- Eliminar la caja (por CASCADE se eliminan sus allocations)
  delete from public.xstore_cash_closures where id = p_closure_id;

  -- Si algún depósito quedó sin ninguna asignación de caja, eliminar también el depósito huérfano
  if v_dep_ids is not null then
    delete from public.xstore_deposits d
    where d.id = any(v_dep_ids)
      and not exists (select 1 from public.xstore_deposit_allocations a where a.deposit_id = d.id);
  end if;
end;
$$;

grant execute on function public.xstore_delete_closure(uuid) to authenticated;
