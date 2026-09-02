-- Pulso · Gestión Xstore: Migración 016 (Vouchers de depósito en dashboard)
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
  review_note text, store_closed boolean, evidence_path text,
  deposit_vouchers jsonb
)
language sql stable security definer set search_path=public as 
  with pdvs as (
    select distinct trim(coalesce(to_jsonb(p)->>'pdv', to_jsonb(p)->>'pdv_nombre', '')) as pdv
    from public.profiles p
    where nullif(trim(coalesce(to_jsonb(p)->>'pdv', to_jsonb(p)->>'pdv_nombre', '')), '') is not null
  ),
  expected as (select p.pdv, d::date as cash_date from pdvs p cross join generate_series(p_from, p_to, interval '1 day') d),
  deposited as (select closure_id, sum(allocated_amount) as amount from public.xstore_deposit_allocations group by closure_id),
  vouchers as (
    select
      a.closure_id,
      jsonb_agg(jsonb_build_object('path', dep.evidence_path, 'amount', a.allocated_amount, 'date', dep.deposit_date)) as list
    from public.xstore_deposit_allocations a
    join public.xstore_deposits dep on dep.id = a.deposit_id
    where nullif(trim(coalesce(dep.evidence_path, '')), '') is not null
    group by a.closure_id
  )
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
    c.evidence_path,
    coalesce(v.list, '[]'::jsonb)
  from expected e
  left join public.xstore_cash_closures c on c.pdv = e.pdv and c.cash_date = e.cash_date
  left join deposited d on d.closure_id = c.id
  left join vouchers v on v.closure_id = c.id
  left join public.profiles pr on lower(pr.email) = lower(c.registered_by_email)
  left join public.profiles pu on lower(pu.email) = lower(c.updated_by_email)
  left join public.profiles pv on lower(pv.email) = lower(c.validated_by_email)
  where public.xstore_can_access_pdv(e.pdv)
  order by e.cash_date desc, e.pdv;
;

grant execute on function public.xstore_dashboard_rows(date,date) to authenticated;
