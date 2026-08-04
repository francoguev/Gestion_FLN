-- Pulso · Gestión Xstore: Migración 010 (PayJoy Desglose + Nombres en Registro)
-- Ejecutar en Supabase SQL Editor para añadir desglose de PayJoy y devolver nombres de usuario en lugar de correos.

alter table public.xstore_cash_closures add column if not exists payjoy_details jsonb default '[]'::jsonb;
alter table public.xstore_cash_closures add column if not exists payjoy_pending_amount numeric(12,2) not null default 0 check (payjoy_pending_amount >= 0);

drop function if exists public.xstore_submit_cash(text,date,numeric,text,boolean,text);
drop function if exists public.xstore_submit_cash(text,date,numeric,text,boolean,text,jsonb);

create or replace function public.xstore_submit_cash(
  p_pdv text, p_cash_date date, p_cash_amount numeric, p_evidence_path text,
  p_store_closed boolean default false, p_store_closed_reason text default null,
  p_payjoy_items jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_current public.xstore_cash_closures;
  v_email text := public.xstore_current_email();
  v_payjoy_pending numeric(12,2) := 0;
begin
  if not public.xstore_can_access_pdv(p_pdv) then raise exception 'No tienes permiso para registrar en este PDV.'; end if;
  if p_cash_date is null or p_cash_date > current_date then raise exception 'La fecha de caja no es válida.'; end if;
  if coalesce(p_cash_amount,-1) < 0 then raise exception 'El monto no es válido.'; end if;

  -- Calcular total pendiente de devolución por PayJoy: Suma(costo - inicial)
  if jsonb_array_length(coalesce(p_payjoy_items,'[]'::jsonb)) > 0 then
    select coalesce(sum(greatest((coalesce((item->>'costo')::numeric,0) - coalesce((item->>'inicial')::numeric,0)),0)),0)
    into v_payjoy_pending
    from jsonb_array_elements(p_payjoy_items) item;
  end if;

  if v_payjoy_pending > p_cash_amount then
    raise exception 'La devolución de PayJoy (S/ %) no puede superar el recaudo de sistema declarado (S/ %).', v_payjoy_pending, p_cash_amount;
  end if;

  if coalesce(p_store_closed,false) then
    if coalesce(p_cash_amount,0) <> 0 then raise exception 'Una tienda que no abrió debe registrar S/ 0.00.'; end if;
    v_payjoy_pending := 0;
    p_payjoy_items := '[]'::jsonb;
  elsif nullif(trim(coalesce(p_evidence_path,'')),'') is null then
    raise exception 'Debes adjuntar la foto de caja.';
  end if;

  select * into v_current from public.xstore_cash_closures where pdv=p_pdv and cash_date=p_cash_date for update;
  if found and (v_current.review_started_at is not null or v_current.status in ('validated','payjoy_validated','difference','store_closed')) then
    raise exception 'Este registro ya está cerrado o en revisión por Operaciones.';
  end if;

  if found then
    update public.xstore_cash_closures set
      cash_amount=coalesce(p_cash_amount,0),
      store_closed=coalesce(p_store_closed,false),
      store_closed_reason=case when coalesce(p_store_closed,false) then nullif(trim(p_store_closed_reason),'') else null end,
      evidence_path=case when coalesce(p_store_closed,false) then null else nullif(trim(p_evidence_path),'') end,
      status=case when coalesce(p_store_closed,false) then 'store_closed' else 'pending_deposit' end,
      payjoy_amount=v_payjoy_pending,
      payjoy_pending_amount=v_payjoy_pending,
      payjoy_details=coalesce(p_payjoy_items,'[]'::jsonb),
      review_note=null,
      validated_at=case when coalesce(p_store_closed,false) then now() else null end,
      validated_by_email=case when coalesce(p_store_closed,false) then v_email else null end,
      updated_at=now(),
      updated_by_email=v_email,
      review_started_at=null,
      review_started_by_email=null
    where id=v_current.id returning id into v_id;

    perform public.xstore_add_audit(v_id,'caja_actualizada',jsonb_build_object('monto',p_cash_amount,'payjoy_pending',v_payjoy_pending,'tienda_no_abrio',p_store_closed));
  else
    insert into public.xstore_cash_closures(
      pdv,cash_date,cash_amount,store_closed,store_closed_reason,evidence_path,status,
      payjoy_amount,payjoy_pending_amount,payjoy_details,
      registered_by_email,updated_by_email,validated_at,validated_by_email
    )
    values(
      p_pdv,p_cash_date,coalesce(p_cash_amount,0),coalesce(p_store_closed,false),
      case when coalesce(p_store_closed,false) then nullif(trim(p_store_closed_reason),'') else null end,
      case when coalesce(p_store_closed,false) then null else nullif(trim(p_evidence_path),'') end,
      case when coalesce(p_store_closed,false) then 'store_closed' else 'pending_deposit' end,
      v_payjoy_pending,v_payjoy_pending,coalesce(p_payjoy_items,'[]'::jsonb),
      v_email,v_email,case when coalesce(p_store_closed,false) then now() else null end,
      case when coalesce(p_store_closed,false) then v_email else null end
    )
    returning id into v_id;

    perform public.xstore_add_audit(v_id,'caja_registrada',jsonb_build_object('monto',p_cash_amount,'payjoy_pending',v_payjoy_pending,'tienda_no_abrio',p_store_closed));
  end if;
  return v_id;
end;
$$;

drop function if exists public.xstore_dashboard_rows(date,date);

create or replace function public.xstore_dashboard_rows(p_from date,p_to date)
returns table(
  closure_id uuid, pdv text, cash_date date, status text, cash_amount numeric,
  payjoy_amount numeric, payjoy_pending_amount numeric, payjoy_details jsonb,
  deposit_amount numeric, expected_amount numeric, outstanding_amount numeric,
  registered_by_email text, registered_by_name text,
  updated_by_email text, updated_by_name text,
  review_started_at timestamptz, review_started_by_email text,
  validated_by_email text, validated_by_name text,
  review_note text, store_closed boolean, evidence_path text
)
language sql stable security definer set search_path=public as $$
  with pdvs as (
    select distinct trim(coalesce(to_jsonb(p)->>'pdv', to_jsonb(p)->>'pdv_nombre', '')) as pdv
    from public.profiles p
    where nullif(trim(coalesce(to_jsonb(p)->>'pdv', to_jsonb(p)->>'pdv_nombre', '')), '') is not null
  ),
  expected as (select p.pdv, d::date as cash_date from pdvs p cross join generate_series(p_from, p_to, interval '1 day') d),
  deposited as (select closure_id, sum(allocated_amount) as amount from public.xstore_deposit_allocations group by closure_id)
  select
    c.id,
    e.pdv,
    e.cash_date,
    coalesce(c.status, 'missing_cash'),
    c.cash_amount,
    coalesce(c.payjoy_amount, 0),
    coalesce(c.payjoy_pending_amount, 0),
    coalesce(c.payjoy_details, '[]'::jsonb),
    coalesce(d.amount, 0),
    case when c.id is null then null else greatest(c.cash_amount - coalesce(c.payjoy_pending_amount, c.payjoy_amount, 0), 0) end,
    case when c.id is null then null else greatest(c.cash_amount - coalesce(c.payjoy_pending_amount, c.payjoy_amount, 0) - coalesce(d.amount, 0), 0) end,
    c.registered_by_email,
    coalesce(to_jsonb(pr)->>'nombre', to_jsonb(pr)->>'full_name', to_jsonb(pr)->>'nombres', to_jsonb(pr)->>'name', c.registered_by_email),
    c.updated_by_email,
    coalesce(to_jsonb(pu)->>'nombre', to_jsonb(pu)->>'full_name', to_jsonb(pu)->>'nombres', to_jsonb(pu)->>'name', c.updated_by_email),
    c.review_started_at,
    c.review_started_by_email,
    c.validated_by_email,
    coalesce(to_jsonb(pv)->>'nombre', to_jsonb(pv)->>'full_name', to_jsonb(pv)->>'nombres', to_jsonb(pv)->>'name', c.validated_by_email),
    c.review_note,
    coalesce(c.store_closed, false),
    c.evidence_path
  from expected e
  left join public.xstore_cash_closures c on c.pdv = e.pdv and c.cash_date = e.cash_date
  left join deposited d on d.closure_id = c.id
  left join public.profiles pr on lower(pr.email) = lower(c.registered_by_email)
  left join public.profiles pu on lower(pu.email) = lower(c.updated_by_email)
  left join public.profiles pv on lower(pv.email) = lower(c.validated_by_email)
  where public.xstore_can_access_pdv(e.pdv)
  order by e.cash_date desc, e.pdv;
$$;

grant execute on function public.xstore_submit_cash(text,date,numeric,text,boolean,text,jsonb), public.xstore_dashboard_rows(date,date) to authenticated;
