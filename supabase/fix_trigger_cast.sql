-- ============================================================
-- ALL-IN-ONE: SỬA TRIGGER + TẠO ADMIN TRỰC TIẾP
-- Chạy toàn bộ script này trong Supabase SQL Editor
-- https://supabase.com/dashboard/project/gdotgcrtivjdpkcchrro/sql/new
-- ============================================================

-- Kích hoạt pgcrypto nếu chưa có để dùng hàm crypt()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- 1. SỬA TRIGGER: fn_handle_new_user (sử dụng TEXT[] thay vì enum auth_provider không tồn tại)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider        TEXT;
  v_full_name       TEXT;
  v_avatar          TEXT;
  v_default_role_id UUID;
BEGIN
  v_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  IF v_provider NOT IN ('email', 'google') THEN
    v_provider := 'email';
  END IF;

  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );
  v_avatar := NEW.raw_user_meta_data->>'avatar_url';

  -- Chèn profile mới với mảng text ARRAY[v_provider]
  INSERT INTO public.profiles (id, email, full_name, avatar_url, auth_providers, is_active)
  VALUES (NEW.id, NEW.email, v_full_name, v_avatar, ARRAY[v_provider], true)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles
  SET auth_providers = array_append(auth_providers, v_provider), updated_at = now()
  WHERE id = NEW.id AND NOT (v_provider = ANY(auth_providers));

  SELECT id INTO v_default_role_id FROM public.roles WHERE code = 'sales' LIMIT 1;
  IF v_default_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, v_default_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. SỬA TRIGGER: fn_handle_linked_identity (sử dụng TEXT[] thay vì enum)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_linked_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.provider NOT IN ('email', 'google') THEN RETURN NEW; END IF;
  UPDATE public.profiles
  SET auth_providers = array_append(auth_providers, NEW.provider), updated_at = now()
  WHERE id = NEW.user_id AND NOT (NEW.provider = ANY(auth_providers));
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. TẠO ADMIN USER TRỰC TIẾP (không cần đăng ký qua UI)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id       UUID;
  v_admin_role_id UUID;
  v_email         TEXT := 'admin@sanhlongvetco.vn';
BEGIN
  -- Kiểm tra user đã tồn tại chưa
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  -- Nếu chưa có → tạo mới trong auth.users (Supabase internal)
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token,
      phone,
      phone_change_token,
      email_change_token_current,
      phone_change,
      reauthentication_token,
      is_sso_user,
      is_anonymous
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      v_email,
      -- bcrypt hash của 'Admin@SanhLong2026!'
      crypt('Admin@SanhLong2026!', gen_salt('bf')),
      now(),                          -- email đã xác nhận
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Quản trị viên"}'::jsonb,
      now(),
      now(),
      'authenticated',
      'authenticated',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      false,
      false
    );

    -- Tạo identity cho email/password
    INSERT INTO auth.identities (
      id, user_id, provider_id, provider,
      identity_data, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_email,
      'email',
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      now(), now(), now()
    );

    -- Tạo profile thủ công (vì trigger chưa chạy lúc insert auth.users từ SQL)
    INSERT INTO public.profiles (id, email, full_name, auth_providers, is_active)
    VALUES (v_user_id, v_email, 'Quản trị viên', ARRAY['email'], true)
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE '✅ Tạo user mới: % (ID: %)', v_email, v_user_id;
  ELSE
    RAISE NOTICE '⚠️  User đã tồn tại: % (ID: %)', v_email, v_user_id;
  END IF;

  -- Gán role ADMIN (xóa role sales mặc định nếu có)
  SELECT id INTO v_admin_role_id FROM public.roles WHERE code = 'admin';

  DELETE FROM public.user_roles
  WHERE user_id = v_user_id
    AND role_id IN (SELECT id FROM public.roles WHERE code IN ('sales','viewer'));

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_user_id, v_admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  -- Gán chi nhánh HCM
  UPDATE public.profiles
  SET branch_id = '11111111-0000-0000-0000-000000000001',
      full_name = COALESCE(full_name, 'Quản trị viên')
  WHERE id = v_user_id;

  RAISE NOTICE '✅ Đã gán role ADMIN cho: %', v_email;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. XÁC NHẬN KẾT QUẢ
-- ─────────────────────────────────────────────────────────────
SELECT
  u.email,
  u.email_confirmed_at IS NOT NULL          AS "Đã xác nhận",
  p.full_name                                AS "Họ tên",
  p.is_active                                AS "Hoạt động",
  p.branch_id IS NOT NULL                    AS "Có chi nhánh",
  (SELECT array_agg(r.code)
   FROM public.user_roles ur
   JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id = u.id)                  AS "Roles"
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE u.email = 'admin@sanhlongvetco.vn';
