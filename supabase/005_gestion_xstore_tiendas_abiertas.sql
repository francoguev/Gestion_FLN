-- Gestión Xstore no depende de Horario: cada PDV de profiles debe declarar su caja diaria.
-- "Tienda no abrió" es un cierre excepcional y no equivale a un recaudo de S/ 0.00.

alter table public.xstore_cash_closures
  add column if not exists store_closed boolean not null default false,
  add column if not exists store_closed_reason text;

alter table public.xstore_cash_closures
  drop constraint if exists xstore_cash_closures_status_check;
alter table public.xstore_cash_closures
  add constraint xstore_cash_closures_status_check check (status in (
    'pending_deposit', 'deposit_review', 'validated', 'payjoy_validated',
    'difference', 'observed', 'no_cash', 'store_closed'
  ));
alter table public.xstore_cash_closures
  drop constraint if exists xstore_cash_closures_store_closed_check;
alter table public.xstore_cash_closures
  add constraint xstore_cash_closures_store_closed_check check (
    (store_closed = false) or (cash_amount = 0)
  );

-- Se reemplaza la firma para que PostgREST reciba nombres de parámetros coherentes.
drop function if exists public.xstore_submit_cash(date, numeric, text, boolean, text);
create function public.xstore_submit_cash(
  p_cash_date date,
  p_cash_amount numeric,
  p_evidence_path text,
  p_store_closed boolean default false,
  p_store_closed_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pdv text := public.xstore_current_pdv();
  v_email text := public.xstore_current_email();
  v_existing public.xstore_cash_closures;
  v_id uuid;
begin
  if public.xstore_current_cargo() <> 'asesor' or coalesce(trim(v_pdv), '') = '' then
    raise exception 'Solo un asesor con PDV asignado puede registrar caja.';
  end if;
  if p_cash_date is null or p_cash_date > current_date then
    raise exception 'La fecha de caja no es válida.';
  end if;
  if coalesce(p_cash_amount, -1) < 0 then
    raise exception 'El monto de caja no es válido.';
  end if;
  if not coalesce(p_store_closed, false) and coalesce(trim(p_evidence_path), '') = '' then
    raise exception 'Debes adjuntar la foto de caja.';
  end if;
  if coalesce(p_store_closed, false) and coalesce(p_cash_amount, 0) <> 0 then
    raise exception 'Una tienda que no abrió no debe registrar recaudo.';
  end if;

  select * into v_existing from public.xstore_cash_closures
  where pdv = v_pdv and cash_date = p_cash_date for update;
  if found then
    if v_existing.review_started_at is not null or v_existing.status in ('validated','payjoy_validated','difference') then
      raise exception 'Operaciones ya inició la revisión de este día.';
    end if;
    update public.xstore_cash_closures set
      cash_amount = coalesce(p_cash_amount, 0),
      no_cash = false, no_cash_reason = null,
      store_closed = coalesce(p_store_closed, false),
      store_closed_reason = case when coalesce(p_store_closed, false) then nullif(trim(p_store_closed_reason), '') else null end,
      evidence_path = case when coalesce(p_store_closed, false) then null else nullif(trim(p_evidence_path), '') end,
      status = case when coalesce(p_store_closed, false) then 'store_closed' else 'pending_deposit' end,
      updated_by_email = v_email, updated_at = now(), payjoy_amount = 0,
      review_note = null, validated_at = null, validated_by_email = null
    where id = v_existing.id returning id into v_id;
    perform public.xstore_add_audit(v_id, 'caja_actualizada', jsonb_build_object('monto', p_cash_amount, 'tienda_no_abrio', coalesce(p_store_closed, false)));
  else
    insert into public.xstore_cash_closures(
      pdv, cash_date, cash_amount, no_cash, no_cash_reason, store_closed, store_closed_reason,
      evidence_path, status, registered_by_email, updated_by_email
    ) values (
      v_pdv, p_cash_date, coalesce(p_cash_amount, 0), false, null,
      coalesce(p_store_closed, false), case when coalesce(p_store_closed, false) then nullif(trim(p_store_closed_reason), '') else null end,
      case when coalesce(p_store_closed, false) then null else nullif(trim(p_evidence_path), '') end,
      case when coalesce(p_store_closed, false) then 'store_closed' else 'pending_deposit' end,
      v_email, v_email
    ) returning id into v_id;
    perform public.xstore_add_audit(v_id, 'caja_registrada', jsonb_build_object('monto', p_cash_amount, 'tienda_no_abrio', coalesce(p_store_closed, false)));
  end if;
  return v_id;
end;
$$;

create or replace function public.xstore_submit_deposit(
  p_deposit_date date,
  p_deposit_amount numeric,
  p_evidence_path text,
  p_allocations jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pdv text := public.xstore_current_pdv();
  v_email text := public.xstore_current_email();
  v_deposit_id uuid;
  v_total numeric;
  v_invalid integer;
begin
  if public.xstore_current_cargo() <> 'asesor' or coalesce(trim(v_pdv), '') = '' then raise exception 'Solo un asesor con PDV asignado puede registrar depósitos.'; end if;
  if p_deposit_date is null or p_deposit_date > current_date then raise exception 'La fecha de depósito no es válida.'; end if;
  if coalesce(p_deposit_amount, 0) <= 0 or coalesce(trim(p_evidence_path), '') = '' then raise exception 'Monto y voucher son obligatorios.'; end if;
  select coalesce(sum((item->>'amount')::numeric), 0) into v_total from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) item;
  if abs(v_total - p_deposit_amount) > 0.01 then raise exception 'La suma asignada debe coincidir con el depósito.'; end if;
  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then raise exception 'Selecciona al menos un día de caja.'; end if;

  select count(*) into v_invalid
  from jsonb_to_recordset(p_allocations) as a(closure_id uuid, amount numeric)
  left join public.xstore_cash_closures c on c.id = a.closure_id
  where c.id is null or c.pdv <> v_pdv or c.no_cash or c.store_closed or c.review_started_at is not null
    or c.status in ('validated','payjoy_validated','difference') or a.amount <= 0;
  if v_invalid > 0 then raise exception 'Uno de los días seleccionados ya no admite depósitos.'; end if;

  insert into public.xstore_deposits(pdv, deposit_date, deposit_amount, evidence_path, registered_by_email)
  values(v_pdv, p_deposit_date, p_deposit_amount, p_evidence_path, v_email) returning id into v_deposit_id;
  insert into public.xstore_deposit_allocations(deposit_id, closure_id, allocated_amount)
  select v_deposit_id, a.closure_id, a.amount from jsonb_to_recordset(p_allocations) as a(closure_id uuid, amount numeric);
  update public.xstore_cash_closures c set status = 'deposit_review', updated_at = now(), updated_by_email = v_email
  where c.id in (select (item->>'closure_id')::uuid from jsonb_array_elements(p_allocations) item);
  perform public.xstore_add_audit((select (item->>'closure_id')::uuid from jsonb_array_elements(p_allocations) item limit 1), 'deposito_registrado', jsonb_build_object('deposito_id', v_deposit_id, 'monto', p_deposit_amount));
  return v_deposit_id;
end;
$$;

drop function if exists public.xstore_dashboard_rows(date, date);
create function public.xstore_dashboard_rows(p_from date, p_to date)
returns table(
  closure_id uuid, pdv text, cash_date date, status text, cash_amount numeric,
  payjoy_amount numeric, deposit_amount numeric, expected_amount numeric, outstanding_amount numeric,
  registered_by_email text, updated_by_email text, review_started_at timestamptz,
  review_started_by_email text, validated_by_email text, review_note text,
  no_cash boolean, store_closed boolean, evidence_path text
) language sql stable security definer set search_path = public as $$
  with pdvs as (
    select distinct trim(p.pdv) as pdv
    from public.profiles p
    where coalesce(trim(p.pdv), '') <> ''
  ), calendar as (
    select day::date as cash_date
    from generate_series(p_from, least(p_to, current_date), interval '1 day') as day
    where p_from <= current_date
  ), expected as (
    select p.pdv, c.cash_date from pdvs p cross join calendar c
    union
    select c.pdv, c.cash_date from public.xstore_cash_closures c
    where c.cash_date between p_from and p_to
  ), deposits as (
    select a.closure_id, coalesce(sum(a.allocated_amount), 0) as total
    from public.xstore_deposit_allocations a group by a.closure_id
  )
  select c.id, e.pdv, e.cash_date,
    case when c.id is null then 'missing_cash' else c.status end,
    c.cash_amount, coalesce(c.payjoy_amount, 0), coalesce(d.total, 0),
    case when c.id is null or c.store_closed then null else c.cash_amount - coalesce(c.payjoy_amount, 0) end,
    case when c.id is null or c.store_closed then null else greatest((c.cash_amount - coalesce(c.payjoy_amount, 0)) - coalesce(d.total, 0), 0) end,
    c.registered_by_email, c.updated_by_email, c.review_started_at, c.review_started_by_email,
    c.validated_by_email, c.review_note, coalesce(c.no_cash, false), coalesce(c.store_closed, false), c.evidence_path
  from expected e
  left join public.xstore_cash_closures c on c.pdv = e.pdv and c.cash_date = e.cash_date
  left join deposits d on d.closure_id = c.id
  where public.xstore_can_access_pdv(e.pdv)
  order by e.cash_date desc, e.pdv;
$$;

revoke all on function public.xstore_submit_cash(date, numeric, text, boolean, text) from public;
revoke all on function public.xstore_dashboard_rows(date, date) from public;
revoke execute on function public.xstore_submit_cash(date, numeric, text, boolean, text) from anon;
revoke execute on function public.xstore_dashboard_rows(date, date) from anon;
grant execute on function public.xstore_submit_cash(date, numeric, text, boolean, text) to authenticated;
grant execute on function public.xstore_dashboard_rows(date, date) to authenticated;
