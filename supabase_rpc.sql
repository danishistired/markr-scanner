-- ============================================================
-- Markr — Supabase RPC Functions
-- Run this SQL in your Supabase SQL Editor (supabase.com → SQL Editor)
-- These functions use SECURITY DEFINER to bypass RLS
-- so the mobile app can call them with the anon key.
-- ============================================================

-- 1. register_device
-- Called when a student registers their device for the first time.
-- Returns JSON with success status and registration data.
CREATE OR REPLACE FUNCTION public.register_device(
  p_fingerprint TEXT,
  p_name TEXT,
  p_uid TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_section TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing RECORD;
BEGIN
  -- Check if device is already registered
  SELECT * INTO existing FROM public.device_registrations
  WHERE device_fingerprint = p_fingerprint;
  
  IF FOUND THEN
    IF existing.is_blocked THEN
      RETURN json_build_object('success', false, 'error', 'device_blocked', 'message', 'This device has been blocked. Contact your administrator.');
    END IF;
    RETURN json_build_object('success', true, 'already_registered', true, 'data', row_to_json(existing));
  END IF;

  -- Register new device
  INSERT INTO public.device_registrations (device_fingerprint, student_name, student_uid, student_email, student_phone, student_section)
  VALUES (p_fingerprint, p_name, p_uid, p_email, p_phone, p_section)
  RETURNING * INTO existing;

  RETURN json_build_object('success', true, 'already_registered', false, 'data', row_to_json(existing));
END;
$$;

-- 2. get_device_registration
-- Called on app launch to check if the device is already registered.
-- Returns JSON with registration status.
CREATE OR REPLACE FUNCTION public.get_device_registration(p_fingerprint TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing RECORD;
BEGIN
  SELECT * INTO existing FROM public.device_registrations
  WHERE device_fingerprint = p_fingerprint;

  IF NOT FOUND THEN
    RETURN json_build_object('registered', false);
  END IF;

  IF existing.is_blocked THEN
    RETURN json_build_object('registered', true, 'blocked', true, 'message', 'This device has been blocked. Contact your administrator.');
  END IF;

  RETURN json_build_object('registered', true, 'blocked', false, 'data', row_to_json(existing));
END;
$$;
