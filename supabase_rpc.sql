-- ============================================================
-- Markr — Complete Supabase Database Schema & RPC Functions
-- Run this entire script in your Supabase SQL Editor:
-- https://supabase.com → SQL Editor → New Query → Run
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. TABLES
-- ─────────────────────────────────────────────────────────────

-- Table: device_registrations
CREATE TABLE IF NOT EXISTS public.device_registrations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint    TEXT        UNIQUE NOT NULL,
  student_name          TEXT        NOT NULL,
  student_uid           TEXT        NOT NULL,
  student_email         TEXT        NOT NULL,
  student_phone         TEXT        NOT NULL,
  student_section       TEXT        NOT NULL,
  is_blocked            BOOLEAN     NOT NULL DEFAULT FALSE,
  allow_reregistration  BOOLEAN     NOT NULL DEFAULT FALSE,
  registered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table: registration_requests (re-registration tickets)
CREATE TABLE IF NOT EXISTS public.registration_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint  TEXT        NOT NULL,
  reason              TEXT        NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  admin_notes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_device_reg_fp ON public.device_registrations(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_reg_req_fp ON public.registration_requests(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_reg_req_status ON public.registration_requests(status);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_reg_updated_at ON public.device_registrations;
CREATE TRIGGER trg_device_reg_updated_at
  BEFORE UPDATE ON public.device_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_reg_req_updated_at ON public.registration_requests;
CREATE TRIGGER trg_reg_req_updated_at
  BEFORE UPDATE ON public.registration_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS
ALTER TABLE public.device_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 2. RPC FUNCTIONS (Called by App with anon key)
-- ─────────────────────────────────────────────────────────────

-- 1. register_device
-- Enforces one-time registration per device.
-- Re-registration requires admin setting allow_reregistration = TRUE.
CREATE OR REPLACE FUNCTION public.register_device(
  p_fingerprint TEXT,
  p_name        TEXT,
  p_uid         TEXT,
  p_email       TEXT,
  p_phone       TEXT,
  p_section     TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing RECORD;
  new_row  RECORD;
BEGIN
  SELECT * INTO existing
    FROM public.device_registrations
   WHERE device_fingerprint = p_fingerprint;

  IF FOUND THEN
    IF existing.is_blocked THEN
      RETURN json_build_object(
        'success', false,
        'error',   'device_blocked',
        'message', 'This device has been blocked. Contact your administrator.'
      );
    END IF;

    -- Admin unlocked re-registration for this device (via allow_reregistration flag or approved request)
    IF existing.allow_reregistration OR EXISTS (
      SELECT 1 FROM public.registration_requests
       WHERE device_fingerprint = p_fingerprint
         AND status = 'approved'
    ) THEN
      UPDATE public.device_registrations
         SET student_name          = p_name,
             student_uid           = p_uid,
             student_email         = p_email,
             student_phone         = p_phone,
             student_section       = p_section,
             allow_reregistration  = FALSE,
             registered_at         = NOW()
       WHERE device_fingerprint = p_fingerprint
       RETURNING * INTO new_row;

      UPDATE public.registration_requests
         SET status     = 'completed',
             updated_at = NOW()
       WHERE device_fingerprint = p_fingerprint
         AND status = 'approved';

      RETURN json_build_object(
        'success',            true,
        'reregistered',       true,
        'already_registered', false,
        'data',               row_to_json(new_row)
      );
    END IF;

    -- Device already registered & not unlocked by admin
    RETURN json_build_object(
      'success',            false,
      'error',              'already_registered',
      'message',            'This device is already registered. Contact an admin to request re-registration.',
      'already_registered', true
    );
  END IF;

  -- First-time registration
  INSERT INTO public.device_registrations
    (device_fingerprint, student_name, student_uid, student_email, student_phone, student_section)
  VALUES
    (p_fingerprint, p_name, p_uid, p_email, p_phone, p_section)
  RETURNING * INTO new_row;

  RETURN json_build_object(
    'success',            true,
    'already_registered', false,
    'data',               row_to_json(new_row)
  );
END;
$$;

-- 2. get_device_registration
-- Checks device status on app startup.
CREATE OR REPLACE FUNCTION public.get_device_registration(p_fingerprint TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing RECORD;
  req      RECORD;
BEGIN
  SELECT * INTO existing
    FROM public.device_registrations
   WHERE device_fingerprint = p_fingerprint;

  IF NOT FOUND THEN
    RETURN json_build_object('registered', false);
  END IF;

  IF existing.is_blocked THEN
    RETURN json_build_object(
      'registered', true,
      'blocked',    true,
      'message',    'This device has been blocked. Contact your administrator.'
    );
  END IF;

  SELECT * INTO req
    FROM public.registration_requests
   WHERE device_fingerprint = p_fingerprint
     AND status IN ('pending', 'approved', 'rejected')
   ORDER BY created_at DESC
   LIMIT 1;

  RETURN json_build_object(
    'registered',            true,
    'blocked',               false,
    'allow_reregistration',  existing.allow_reregistration,
    'reregistration_request', CASE
      WHEN req.id IS NOT NULL THEN json_build_object(
        'status',      req.status,
        'admin_notes', req.admin_notes,
        'created_at',  req.created_at
      )
      ELSE NULL
    END,
    'data', row_to_json(existing)
  );
END;
$$;

-- 3. submit_reregistration_request
-- Submits a ticket requesting admin approval for re-registration.
CREATE OR REPLACE FUNCTION public.submit_reregistration_request(
  p_fingerprint TEXT,
  p_reason      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing    RECORD;
  pending_req RECORD;
  new_req_id  UUID;
BEGIN
  IF char_length(trim(p_reason)) < 10 THEN
    RETURN json_build_object('success', false, 'error', 'reason_too_short');
  END IF;

  SELECT * INTO existing
    FROM public.device_registrations
   WHERE device_fingerprint = p_fingerprint;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'device_not_registered');
  END IF;

  IF existing.is_blocked THEN
    RETURN json_build_object('success', false, 'error', 'device_blocked');
  END IF;

  SELECT * INTO pending_req
    FROM public.registration_requests
   WHERE device_fingerprint = p_fingerprint
     AND status = 'pending'
   LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object(
      'success',    false,
      'error',      'request_already_pending',
      'request_id', pending_req.id,
      'created_at', pending_req.created_at
    );
  END IF;

  INSERT INTO public.registration_requests (device_fingerprint, reason)
  VALUES (p_fingerprint, trim(p_reason))
  RETURNING id INTO new_req_id;

  RETURN json_build_object(
    'success',    true,
    'request_id', new_req_id
  );
END;
$$;

-- 4. get_reregistration_status
-- Polls status of latest ticket.
CREATE OR REPLACE FUNCTION public.get_reregistration_status(p_fingerprint TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req
    FROM public.registration_requests
   WHERE device_fingerprint = p_fingerprint
     AND status IN ('pending', 'approved', 'rejected')
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('has_request', false);
  END IF;

  RETURN json_build_object(
    'has_request',  true,
    'status',       req.status,
    'admin_notes',  req.admin_notes,
    'created_at',   req.created_at
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. ADMIN PANEL FUNCTIONS
-- ─────────────────────────────────────────────────────────────

-- 1. admin_get_all_requests
-- Retrieves all re-registration requests along with student registration details.
CREATE OR REPLACE FUNCTION public.admin_get_all_requests()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'id',                 r.id,
      'device_fingerprint', r.device_fingerprint,
      'reason',             r.reason,
      'status',             r.status,
      'admin_notes',        r.admin_notes,
      'created_at',         r.created_at,
      'updated_at',         r.updated_at,
      'student_name',       d.student_name,
      'student_uid',        d.student_uid,
      'student_email',      d.student_email,
      'student_phone',      d.student_phone,
      'student_section',    d.student_section
    ) ORDER BY r.created_at DESC
  ) INTO result
  FROM public.registration_requests r
  LEFT JOIN public.device_registrations d ON TRIM(r.device_fingerprint) = TRIM(d.device_fingerprint);

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 2. admin_approve_request
-- Approves request AND DELETES user registration from device_registrations table
-- to allow the user to register again.
CREATE OR REPLACE FUNCTION public.admin_approve_request(p_request_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_fp TEXT;
BEGIN
  SELECT device_fingerprint INTO target_fp
    FROM public.registration_requests
   WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'request_not_found');
  END IF;

  -- Delete user info from device_registrations to allow new registration
  DELETE FROM public.device_registrations
   WHERE device_fingerprint = target_fp;

  -- Mark request status as approved
  UPDATE public.registration_requests
     SET status     = 'approved',
         updated_at = NOW()
   WHERE id = p_request_id;

  RETURN json_build_object('success', true);
END;
$$;

-- 3. admin_reject_request
-- Rejects a request with optional admin notes.
CREATE OR REPLACE FUNCTION public.admin_reject_request(
  p_request_id UUID,
  p_notes      TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.registration_requests
     SET status      = 'rejected',
         admin_notes  = p_notes,
         updated_at   = NOW()
   WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'request_not_found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

