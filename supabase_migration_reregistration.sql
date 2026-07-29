-- ============================================================
-- Markr — Schema Migration: One-Time Registration Lock
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Add allow_reregistration column to device_registrations
--    Admin sets this to TRUE to unlock exactly one re-registration.
--    It is atomically reset to FALSE when the re-registration completes.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.device_registrations
  ADD COLUMN IF NOT EXISTS allow_reregistration BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────
-- 2. Create registration_requests table
--    Stores re-registration tickets submitted by users.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.registration_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint  TEXT        NOT NULL,
  reason              TEXT        NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-fingerprint lookups
CREATE INDEX IF NOT EXISTS idx_reg_requests_fingerprint
  ON public.registration_requests (device_fingerprint);

CREATE INDEX IF NOT EXISTS idx_reg_requests_status
  ON public.registration_requests (status);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registration_requests_updated_at ON public.registration_requests;
CREATE TRIGGER trg_registration_requests_updated_at
  BEFORE UPDATE ON public.registration_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. Row-Level Security on registration_requests
--    Anon key (app) can INSERT and read only its own rows.
--    Service-role key (admin portal) bypasses RLS entirely.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;

-- Allow app to submit a request (insert only, no fingerprint required in policy
-- because we validate inside the RPC with SECURITY DEFINER)
DROP POLICY IF EXISTS "app_insert_requests" ON public.registration_requests;
CREATE POLICY "app_insert_requests"
  ON public.registration_requests
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- App can read only requests matching the fingerprint they provide
-- (enforced inside the RPC — no direct table SELECT via anon key)
-- Service-role bypasses RLS automatically.

-- ─────────────────────────────────────────────────────────────
-- 4. UPDATED: register_device
--    Now enforces one-time registration.
--    Re-registration only allowed if allow_reregistration = TRUE.
--    That flag is consumed atomically (reset to FALSE on use).
-- ─────────────────────────────────────────────────────────────
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
  -- Look up existing registration
  SELECT * INTO existing
    FROM public.device_registrations
   WHERE device_fingerprint = p_fingerprint;

  IF FOUND THEN
    -- Blocked devices cannot register at all
    IF existing.is_blocked THEN
      RETURN json_build_object(
        'success', false,
        'error',   'device_blocked',
        'message', 'This device has been blocked. Contact your administrator.'
      );
    END IF;

    -- Admin has approved a one-shot re-registration
    IF existing.allow_reregistration OR EXISTS (
      SELECT 1 FROM public.registration_requests
       WHERE device_fingerprint = p_fingerprint
         AND status = 'approved'
    ) THEN
      -- Atomically: reset flag, update student details
      UPDATE public.device_registrations
         SET student_name          = p_name,
             student_uid           = p_uid,
             student_email         = p_email,
             student_phone         = p_phone,
             student_section       = p_section,
             allow_reregistration  = FALSE,       -- consumed — cannot reuse
             registered_at         = NOW()
       WHERE device_fingerprint = p_fingerprint
       RETURNING * INTO new_row;

      -- Mark the approved request as completed
      UPDATE public.registration_requests
         SET status     = 'completed',
             updated_at = NOW()
       WHERE device_fingerprint = p_fingerprint
         AND status = 'approved';

      RETURN json_build_object(
        'success',        true,
        'reregistered',   true,
        'already_registered', false,
        'data',           row_to_json(new_row)
      );
    END IF;

    -- Already registered, re-registration NOT unlocked by admin
    RETURN json_build_object(
      'success',            false,
      'error',              'already_registered',
      'message',            'This device is already registered. Contact an admin to request re-registration.',
      'already_registered', true
    );
  END IF;

  -- UID uniqueness: reject if this student_uid is already registered on ANY device
  PERFORM 1
    FROM public.device_registrations
   WHERE student_uid = p_uid
     AND is_blocked = FALSE;

  IF FOUND THEN
    RETURN json_build_object(
      'success',            false,
      'error',              'already_registered',
      'message',            'This UID is already registered to another device. Contact an admin to request re-registration.',
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

-- ─────────────────────────────────────────────────────────────
-- 5. UPDATED: get_device_registration
--    Now also returns re-registration request status so the app
--    can show the correct screen on cold boot.
-- ─────────────────────────────────────────────────────────────
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
    -- Device not in device_registrations — check if they have a pending request
    -- (e.g. UID conflict prevented insert, but they submitted a re-reg request)
    SELECT * INTO req
      FROM public.registration_requests
     WHERE device_fingerprint = p_fingerprint
       AND status IN ('pending', 'approved', 'rejected')
     ORDER BY created_at DESC
     LIMIT 1;

    IF req.id IS NOT NULL THEN
      RETURN json_build_object(
        'registered',             false,
        'reregistration_request', json_build_object(
          'status',      req.status,
          'admin_notes', req.admin_notes,
          'created_at',  req.created_at
        )
      );
    END IF;

    RETURN json_build_object('registered', false);
  END IF;

  IF existing.is_blocked THEN
    RETURN json_build_object(
      'registered', true,
      'blocked',    true,
      'message',    'This device has been blocked. Contact your administrator.'
    );
  END IF;

  -- Check latest re-registration request status
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

-- ─────────────────────────────────────────────────────────────
-- 6. NEW: submit_reregistration_request
--    Called by the app when a user wants to request re-registration.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_reregistration_request(
  p_fingerprint TEXT,
  p_reason      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing     RECORD;
  pending_req  RECORD;
  new_req_id   UUID;
BEGIN
  -- Sanitise reason length (belt-and-suspenders; CHECK constraint also enforces)
  IF char_length(trim(p_reason)) < 10 THEN
    RETURN json_build_object('success', false, 'error', 'reason_too_short');
  END IF;

  -- If device exists and is blocked, reject
  SELECT * INTO existing
    FROM public.device_registrations
   WHERE device_fingerprint = p_fingerprint;

  IF FOUND AND existing.is_blocked THEN
    RETURN json_build_object('success', false, 'error', 'device_blocked');
  END IF;

  -- Reject if a pending request already exists (prevent spam)
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

  -- Insert new request
  INSERT INTO public.registration_requests (device_fingerprint, reason)
  VALUES (p_fingerprint, trim(p_reason))
  RETURNING id INTO new_req_id;

  RETURN json_build_object(
    'success',    true,
    'request_id', new_req_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. NEW: get_reregistration_status
--    Called by the RequestPendingScreen to poll request status.
-- ─────────────────────────────────────────────────────────────
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
-- Done. Tables and RPCs are ready.
-- ─────────────────────────────────────────────────────────────
