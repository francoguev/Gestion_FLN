-- Gestión Xstore: la edición respeta la secuencia caja -> depósito -> conciliación.
-- Aplicado en producción el 2026-08-03. Ejecutar una sola vez en proyectos nuevos.

create or replace function public.xstore_update_cash_before_deposit(
  p_closure_id uuid, p_cash_amount numeric, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_record public.xstore_cash_closures;
begin
  if coalesce(p_cash_amount,-1) < 0 then raise exception 'El monto no es válido.'; end if;
  select * into v_record from public.xstore_cash_closures where id=p_closure_id and not store_closed for update;
  if not found or not public.xstore_can_access_pdv(v_record.pdv) then raise exception 'No tienes permiso para editar este recaudo.'; end if;
  if v_record.review_started_at is not null or v_record.status not in ('pending_deposit','observed')
     or exists(select 1 from public.xstore_deposit_allocations a where a.closure_id=p_closure_id) then
    raise exception 'El recaudo solo se puede editar antes de registrar un depósito y antes de la conciliación.';
  end if;
  update public.xstore_cash_closures
  set cash_amount=p_cash_amount, status='pending_deposit', review_note=nullif(trim(p_note),''),
      updated_at=now(), updated_by_email=public.xstore_current_email()
  where id=p_closure_id;
  perform public.xstore_add_audit(p_closure_id,'recaudo_editado_antes_deposito',jsonb_build_object('monto',p_cash_amount,'nota',p_note));
end;
$$;

create or replace function public.xstore_update_deposit_allocation(
  p_closure_id uuid, p_deposit_id uuid, p_allocated_amount numeric, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_pdv text; v_status text; v_review_owner text; v_deposit_pdv text;
begin
  if coalesce(p_allocated_amount,0) <= 0 then raise exception 'El monto depositado debe ser mayor a cero.'; end if;
  select c.pdv,c.status,c.review_started_by_email,d.pdv into v_pdv,v_status,v_review_owner,v_deposit_pdv
  from public.xstore_deposit_allocations a
  join public.xstore_cash_closures c on c.id=a.closure_id
  join public.xstore_deposits d on d.id=a.deposit_id
  where a.closure_id=p_closure_id and a.deposit_id=p_deposit_id
  for update of a,c,d;
  if not found or v_pdv<>v_deposit_pdv or not public.xstore_can_access_pdv(v_pdv) then raise exception 'No tienes permiso para editar este depósito.'; end if;
  if v_review_owner is not null and v_review_owner <> public.xstore_current_email() then raise exception 'Este caso está en revisión por otro usuario de Operaciones.'; end if;
  if v_status in ('validated','payjoy_validated','difference') and not public.xstore_is_operations() then raise exception 'Solo Operaciones puede corregir un depósito ya conciliado.'; end if;
  if v_status not in ('deposit_review','observed','validated','payjoy_validated','difference') then raise exception 'Este depósito no está disponible para edición.'; end if;
  update public.xstore_deposit_allocations set allocated_amount=p_allocated_amount where closure_id=p_closure_id and deposit_id=p_deposit_id;
  update public.xstore_deposits d set deposit_amount=(select coalesce(sum(a.allocated_amount),0) from public.xstore_deposit_allocations a where a.deposit_id=d.id) where d.id=p_deposit_id;
  update public.xstore_cash_closures
  set status='deposit_review', payjoy_amount=0, validated_at=null, validated_by_email=null,
      review_started_at=null, review_started_by_email=null, review_note=nullif(trim(p_note),''),
      updated_at=now(), updated_by_email=public.xstore_current_email()
  where id=p_closure_id;
  perform public.xstore_add_audit(p_closure_id,'deposito_editado',jsonb_build_object('deposito_id',p_deposit_id,'monto_asignado',p_allocated_amount,'nota',p_note));
end;
$$;

revoke all on function public.xstore_update_cash_before_deposit(uuid,numeric,text),public.xstore_update_deposit_allocation(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.xstore_update_cash_before_deposit(uuid,numeric,text),public.xstore_update_deposit_allocation(uuid,uuid,numeric,text) to authenticated;
