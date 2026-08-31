-- 015_bitacora_module.sql: Módulo de Bitácora, Alertas, Validación y Resumen

CREATE TABLE IF NOT EXISTS public.bitacora_categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT UNIQUE NOT NULL,
  es_sistema BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.bitacora_categorias (nombre, es_sistema) VALUES
  ('SISTEMA', true),
  ('STOCK', true),
  ('COMPETENCIA', true),
  ('PRECIO', true),
  ('OFERTA COMERCIAL', true),
  ('OTRO CANAL', true)
ON CONFLICT (nombre) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.bitacora_alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  user_name TEXT NOT NULL,
  pdv TEXT NOT NULL,
  cargo TEXT NOT NULL,
  categorias TEXT[] NOT NULL,
  detalle TEXT NOT NULL,
  imagen_url TEXT,
  aplica_todos_pdv BOOLEAN DEFAULT FALSE,
  validado BOOLEAN DEFAULT FALSE,
  validado_por TEXT,
  validado_email TEXT,
  validado_at TIMESTAMPTZ,
  estado TEXT DEFAULT 'pendiente',
  solucionado_por TEXT,
  solucionado_email TEXT,
  solucionado_at TIMESTAMPTZ,
  alerta_origen_id UUID REFERENCES public.bitacora_alertas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bitacora_created_at ON public.bitacora_alertas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bitacora_pdv ON public.bitacora_alertas (pdv);

ALTER TABLE public.bitacora_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_alertas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bitacora_cat_read" ON public.bitacora_categorias;
CREATE POLICY "bitacora_cat_read" ON public.bitacora_categorias FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "bitacora_cat_insert" ON public.bitacora_categorias;
CREATE POLICY "bitacora_cat_insert" ON public.bitacora_categorias FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "bitacora_alertas_all" ON public.bitacora_alertas;
CREATE POLICY "bitacora_alertas_all" ON public.bitacora_alertas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.bitacora_get_categories()
RETURNS TABLE (
  id UUID,
  nombre TEXT,
  es_sistema BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.nombre, c.es_sistema
  FROM public.bitacora_categorias c
  ORDER BY c.es_sistema DESC, c.nombre ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.bitacora_add_category(p_nombre TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_name TEXT;
  v_cat_id UUID;
BEGIN
  v_clean_name := upper(trim(p_nombre));
  IF v_clean_name IS NULL OR length(v_clean_name) = 0 THEN
    RAISE EXCEPTION 'El nombre de la categoría no puede estar vacío.';
  END IF;

  INSERT INTO public.bitacora_categorias (nombre, es_sistema)
  VALUES (v_clean_name, false)
  ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
  RETURNING id INTO v_cat_id;

  RETURN jsonb_build_object('success', true, 'nombre', v_clean_name, 'id', v_cat_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.bitacora_create_alerta(
  p_categorias TEXT[],
  p_detalle TEXT,
  p_imagen_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_email TEXT;
  v_user_name TEXT;
  v_pdv TEXT;
  v_cargo TEXT;
  v_alerta_id UUID;
BEGIN
  v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  SELECT full_name, coalesce(pdv, 'Sin PDV'), coalesce(cargo, 'asesor')
  INTO v_user_name, v_pdv, v_cargo
  FROM public.profiles
  WHERE lower(email) = v_caller_email;

  IF v_user_name IS NULL THEN
    v_user_name := v_caller_email;
    v_pdv := 'Sin PDV';
    v_cargo := 'asesor';
  END IF;

  INSERT INTO public.bitacora_alertas (
    email, user_name, pdv, cargo, categorias, detalle, imagen_url
  ) VALUES (
    v_caller_email, v_user_name, v_pdv, v_cargo, p_categorias, trim(p_detalle), p_imagen_url
  ) RETURNING id INTO v_alerta_id;

  RETURN jsonb_build_object('success', true, 'id', v_alerta_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.bitacora_get_alertas(
  p_pdv_filter TEXT DEFAULT NULL,
  p_categoria_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  user_name TEXT,
  pdv TEXT,
  cargo TEXT,
  categorias TEXT[],
  detalle TEXT,
  imagen_url TEXT,
  aplica_todos_pdv BOOLEAN,
  validado BOOLEAN,
  validado_por TEXT,
  validado_at TIMESTAMPTZ,
  estado TEXT,
  solucionado_por TEXT,
  solucionado_at TIMESTAMPTZ,
  alerta_origen_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_email TEXT;
  v_user_pdv TEXT;
  v_is_asesor BOOLEAN;
BEGIN
  v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  SELECT coalesce(pdv, ''), (lower(trim(coalesce(cargo, 'asesor'))) = 'asesor' AND coalesce(es_administrador, false) = FALSE)
  INTO v_user_pdv, v_is_asesor
  FROM public.profiles
  WHERE lower(email) = v_caller_email;

  RETURN QUERY
  SELECT 
    a.id, a.email, a.user_name, a.pdv, a.cargo, a.categorias, a.detalle,
    a.imagen_url, a.aplica_todos_pdv, a.validado, a.validado_por, a.validado_at,
    a.estado, a.solucionado_por, a.solucionado_at, a.alerta_origen_id, a.created_at
  FROM public.bitacora_alertas a
  WHERE (
    (v_is_asesor IS TRUE AND (a.pdv = v_user_pdv OR a.aplica_todos_pdv = TRUE))
    OR
    (v_is_asesor IS NOT TRUE AND (p_pdv_filter IS NULL OR p_pdv_filter = '' OR a.pdv = p_pdv_filter OR a.aplica_todos_pdv = TRUE))
  )
  AND (
    p_categoria_filter IS NULL OR p_categoria_filter = '' OR p_categoria_filter = ANY(a.categorias)
  )
  ORDER BY a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.bitacora_validar_alerta(
  p_alerta_id UUID,
  p_aplica_todos_pdv BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_email TEXT;
  v_sup_name TEXT;
BEGIN
  v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  SELECT full_name INTO v_sup_name
  FROM public.profiles
  WHERE lower(email) = v_caller_email;

  UPDATE public.bitacora_alertas
  SET validado = TRUE,
      validado_por = coalesce(v_sup_name, v_caller_email),
      validado_email = v_caller_email,
      validado_at = now(),
      aplica_todos_pdv = coalesce(p_aplica_todos_pdv, false),
      estado = CASE WHEN estado = 'pendiente' THEN 'validado' ELSE estado END
  WHERE id = p_alerta_id;

  RETURN jsonb_build_object('success', true, 'id', p_alerta_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.bitacora_solucionar_alerta(
  p_alerta_id UUID,
  p_detalle_solucion TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_email TEXT;
  v_sup_name TEXT;
  v_sup_pdv TEXT;
  v_sup_cargo TEXT;
  v_orig public.bitacora_alertas%ROWTYPE;
  v_sol_id UUID;
  v_sol_detalle TEXT;
BEGIN
  v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  SELECT full_name, coalesce(pdv, 'Oficina'), coalesce(cargo, 'supervisor')
  INTO v_sup_name, v_sup_pdv, v_sup_cargo
  FROM public.profiles
  WHERE lower(email) = v_caller_email;

  SELECT * INTO v_orig FROM public.bitacora_alertas WHERE id = p_alerta_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'La alerta no existe.';
  END IF;

  UPDATE public.bitacora_alertas
  SET estado = 'solucionado',
      solucionado_por = coalesce(v_sup_name, v_caller_email),
      solucionado_email = v_caller_email,
      solucionado_at = now()
  WHERE id = p_alerta_id;

  v_sol_detalle := '🟢 ALERTA SOLUCIONADA por ' || coalesce(v_sup_name, v_caller_email) || '.';
  IF p_detalle_solucion IS NOT NULL AND length(trim(p_detalle_solucion)) > 0 THEN
    v_sol_detalle := v_sol_detalle || ' Notas: ' || trim(p_detalle_solucion);
  END IF;

  INSERT INTO public.bitacora_alertas (
    email, user_name, pdv, cargo, categorias, detalle,
    aplica_todos_pdv, validado, validado_por, validado_at,
    estado, solucionado_por, solucionado_at, alerta_origen_id
  ) VALUES (
    v_caller_email, coalesce(v_sup_name, v_caller_email), v_orig.pdv, v_sup_cargo, v_orig.categorias, v_sol_detalle,
    v_orig.aplica_todos_pdv, true, coalesce(v_sup_name, v_caller_email), now(),
    'solucionado', coalesce(v_sup_name, v_caller_email), now(), p_alerta_id
  ) RETURNING id INTO v_sol_id;

  RETURN jsonb_build_object('success', true, 'orig_id', p_alerta_id, 'sol_id', v_sol_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.bitacora_eliminar_alerta(p_alerta_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.bitacora_alertas WHERE id = p_alerta_id;
  RETURN jsonb_build_object('success', true, 'id', p_alerta_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bitacora_get_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_add_category(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_create_alerta(TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_get_alertas(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_validar_alerta(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_solucionar_alerta(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_eliminar_alerta(UUID) TO authenticated;
