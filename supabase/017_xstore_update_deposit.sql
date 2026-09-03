-- Pulso · Gestión Xstore: Migración 017 (Edición Integral de Depósitos Bancarios)
drop function if exists public.xstore_submit_deposit(text,date,numeric,text,jsonb);
drop function if exists public.xstore_submit_deposit(text,date,numeric,text,jsonb,uuid);

create or replace function public.xstore_submit_deposit(
  p_pdv text, p_deposit_date date, p_deposit_amount numeric, p_evidence_path text, p_allocations jsonb,
  p_deposit_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as 
declare
  v_id uuid := p_deposit_id;
  v_sum numeric;
  v_invalid integer;
  v_email text := public.xstore_current_email();
  v_old_closures uuid[];
begin
  if not public.xstore_can_access_pdv(p_pdv) then raise exception 'No tienes permiso para registrar en este PDV.'; end if;
  if p_deposit_date is null or p_deposit_date > current_date then raise exception 'La fecha del depósito no es válida.'; end if;
  if coalesce(p_deposit_amount,0) <= 0 or nullif(trim(coalesce(p_evidence_path,'')),'') is null then raise exception 'Monto y voucher son obligatorios.'; end if;
  if jsonb_array_length(coalesce(p_allocations,'[]'::jsonb)) = 0 then raise exception 'Selecciona al menos una fecha de caja.'; end if;

  select coalesce(sum((item->>'amount')::numeric),0) into v_sum from jsonb_array_elements(p_allocations) item;
  if abs(v_sum - p_deposit_amount) > .01 then raise exception 'La suma de los días asignados (S/ %) debe coincidir con el voucher (S/ %).', v_sum, p_deposit_amount; end if;

  -- Se permite asignación > 0 sin bloquear si el monto supera el recaudo esperado (Sobrante por factor humano)
  select count(*) into v_invalid from jsonb_to_recordset(p_allocations) a(closure_id uuid, amount numeric)
  left join public.xstore_cash_closures c on c.id=a.closure_id
  where c.id is null or c.pdv <> p_pdv or c.store_closed or c.review_started_at is not null
    or c.status in ('validated','payjoy_validated','difference') or a.amount <= 0;

  if v_invalid > 0 then raise exception 'Una fecha seleccionada ya no admite depósito o contiene un monto inválido.'; end if;

  if v_id is not null then
    select array_agg(closure_id) into v_old_closures from public.xstore_deposit_allocations where deposit_id = v_id;

    update public.xstore_deposits set
      pdv = p_pdv,
      deposit_date = p_deposit_date,
      deposit_amount = p_deposit_amount,
      evidence_path = p_evidence_path
    where id = v_id;

    delete from public.xstore_deposit_allocations where deposit_id = v_id;
  else
    insert into public.xstore_deposits(pdv,deposit_date,deposit_amount,evidence_path,registered_by_email)
    values(p_pdv,p_deposit_date,p_deposit_amount,p_evidence_path,v_email) returning id into v_id;
  end if;

  insert into public.xstore_deposit_allocations(deposit_id,closure_id,allocated_amount)
  select v_id, a.closure_id, a.amount from jsonb_to_recordset(p_allocations) a(closure_id uuid, amount numeric);

  update public.xstore_cash_closures set status='deposit_review', updated_at=now(), updated_by_email=v_email
  where id in (select (item->>'closure_id')::uuid from jsonb_array_elements(p_allocations) item);

  if v_old_closures is not null then
    update public.xstore_cash_closures c set
      status = case when (select count(*) from public.xstore_deposit_allocations a where a.closure_id = c.id) > 0 then 'deposit_review' else 'pending_deposit' end
    where c.id = any(v_old_closures) and c.status not in ('validated','payjoy_validated','difference');
  end if;

  return v_id;
end;
;

grant execute on function public.xstore_submit_deposit(text,date,numeric,text,jsonb,uuid) to authenticated;
