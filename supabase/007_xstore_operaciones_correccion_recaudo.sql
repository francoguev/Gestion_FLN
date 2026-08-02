-- Solo Operaciones puede corregir el monto reportado por el asesor.
-- Cada corrección queda registrada en la auditoría del cierre.

create or replace function public.xstore_correct_cash_amount(
  p_closure_id uuid,
  p_cash_amount numeric,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_amount numeric;
  v_status text;
begin
  if not public.xstore_is_operations() then
    raise exception 'Solo Operaciones puede corregir el recaudo.';
  end if;
  if coalesce(p_cash_amount, -1) < 0 then
    raise exception 'El monto corregido no es válido.';
  end if;

  select cash_amount, status into v_previous_amount, v_status
  from public.xstore_cash_closures
  where id = p_closure_id
  for update;

  if not found then
    raise exception 'No se encontró el cierre.';
  end if;
  if v_status in ('validated', 'payjoy_validated', 'difference', 'store_closed') then
    raise exception 'Este cierre ya está finalizado y no puede corregirse.';
  end if;

  update public.xstore_cash_closures
  set cash_amount = p_cash_amount,
      updated_at = now(),
      updated_by_email = public.xstore_current_email()
  where id = p_closure_id;

  perform public.xstore_add_audit(
    p_closure_id,
    'recaudo_corregido_por_operaciones',
    jsonb_build_object(
      'monto_anterior', v_previous_amount,
      'monto_corregido', p_cash_amount,
      'nota', nullif(trim(p_note), '')
    )
  );
end;
$$;

revoke all on function public.xstore_correct_cash_amount(uuid, numeric, text) from public;
revoke execute on function public.xstore_correct_cash_amount(uuid, numeric, text) from anon;
grant execute on function public.xstore_correct_cash_amount(uuid, numeric, text) to authenticated;
