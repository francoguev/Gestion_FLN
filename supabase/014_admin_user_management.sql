-- 014_admin_user_management.sql: Gestión de Usuarios y Permisos Administrativos

-- 1. Agregar columnas es_administrador y clave_asignada a public.profiles si no existen
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS es_administrador BOOLEAN DEFAULT FALSE;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS clave_asignada TEXT;

-- 2. Asegurar que los perfiles existentes de administración tengan es_administrador = TRUE
UPDATE public.profiles
SET es_administrador = TRUE
WHERE lower(cargo) = 'operaciones'
  AND lower(email) IN (
    'operaciones.fortalecernos@gmail.com',
    'francisco.guevara@fortalecernos.pe'
  );

-- 3. Función auxiliar para verificar si el usuario activo es administrador
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
  v_is_adm BOOLEAN := FALSE;
BEGIN
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  
  IF (v_email IS NULL OR v_email = '') AND auth.uid() IS NOT NULL THEN
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;

  IF v_email IS NOT NULL AND v_email <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE lower(email) = v_email
        AND (es_administrador = TRUE OR lower(trim(coalesce(cargo, ''))) = 'administrador')
    ) INTO v_is_adm;
  END IF;

  RETURN coalesce(v_is_adm, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 4. Función RPC para que el Administrador consulte la lista de usuarios con sus claves asignadas
DROP FUNCTION IF EXISTS public.xstore_admin_list_users();

CREATE OR REPLACE FUNCTION public.xstore_admin_list_users()
RETURNS TABLE (
  email TEXT,
  full_name TEXT,
  cargo TEXT,
  pdv TEXT,
  es_administrador BOOLEAN,
  clave_asignada TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de administrador.';
  END IF;

  RETURN QUERY
  SELECT 
    p.email::TEXT,
    p.full_name::TEXT,
    p.cargo::TEXT,
    p.pdv::TEXT,
    coalesce(p.es_administrador, false)::BOOLEAN,
    p.clave_asignada::TEXT,
    p.created_at::TIMESTAMPTZ
  FROM public.profiles p
  ORDER BY p.full_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.xstore_admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.xstore_admin_list_users() TO authenticated;

-- 5. Función RPC para que el Administrador cree o actualice perfiles y usuarios de autenticación desde la App
CREATE OR REPLACE FUNCTION public.xstore_admin_save_profile(
  p_email TEXT,
  p_full_name TEXT,
  p_cargo TEXT,
  p_pdv TEXT,
  p_password TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller_email TEXT;
  v_is_adm BOOLEAN;
  v_target_user_id UUID;
  v_sanitized_cargo TEXT;
  v_clean_email TEXT;
  v_encrypted_pass TEXT;
  v_inst_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_clean_email := lower(trim(p_email));

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(email) = v_caller_email
      AND (es_administrador = TRUE OR lower(trim(coalesce(cargo, ''))) = 'administrador')
  ) INTO v_is_adm;

  IF NOT v_is_adm THEN
    RAISE EXCEPTION 'Acceso denegado: Se requieren permisos de administrador.';
  END IF;

  v_sanitized_cargo := lower(trim(coalesce(p_cargo, 'asesor')));
  IF v_sanitized_cargo IN ('administrador') THEN
    v_sanitized_cargo := 'asesor';
  END IF;

  -- 1. Insertar o actualizar en public.profiles
  INSERT INTO public.profiles (email, full_name, cargo, pdv, clave_asignada)
  VALUES (v_clean_email, trim(p_full_name), v_sanitized_cargo, trim(p_pdv), p_password)
  ON CONFLICT (email) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      cargo = CASE WHEN public.profiles.es_administrador = TRUE THEN public.profiles.cargo ELSE EXCLUDED.cargo END,
      pdv = EXCLUDED.pdv,
      clave_asignada = CASE WHEN EXCLUDED.clave_asignada IS NOT NULL AND length(trim(EXCLUDED.clave_asignada)) > 0 THEN EXCLUDED.clave_asignada ELSE public.profiles.clave_asignada END;

  -- 2. Manejar la cuenta en auth.users
  SELECT id INTO v_target_user_id FROM auth.users WHERE lower(email) = v_clean_email;

  IF p_password IS NOT NULL AND length(trim(p_password)) > 0 THEN
    v_encrypted_pass := crypt(p_password, gen_salt('bf'));

    IF v_target_user_id IS NULL THEN
      -- Crear nuevo usuario directamente en auth.users si no existe
      v_target_user_id := gen_random_uuid();

      SELECT instance_id INTO v_inst_id FROM auth.users LIMIT 1;
      IF v_inst_id IS NULL THEN v_inst_id := '00000000-0000-0000-0000-000000000000'; END IF;

      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) VALUES (
        v_inst_id, v_target_user_id, 'authenticated', 'authenticated', v_clean_email, v_encrypted_pass, now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', trim(p_full_name)), now(), now(), '', '', '', ''
      );

      INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_target_user_id::text, v_target_user_id, jsonb_build_object('sub', v_target_user_id::text, 'email', v_clean_email), 'email', now(), now(), now()
      );

    ELSE
      -- Actualizar contraseña de usuario existente
      UPDATE auth.users
      SET encrypted_password = v_encrypted_pass,
          updated_at = now()
      WHERE id = v_target_user_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'email', v_clean_email, 'user_id', v_target_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.xstore_admin_save_profile(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.xstore_admin_save_profile(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
