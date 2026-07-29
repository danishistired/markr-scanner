-- Fix get_device_registration: for unregistered devices, also check
-- registration_requests so the app can restore the request_pending screen
-- on reload (covers UID-conflict scenario where device was never inserted).

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
    -- Device not in device_registrations, but may have a pending request
    -- (e.g. UID conflict prevented insert, user submitted a re-reg request)
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
    'registered',             true,
    'blocked',                false,
    'allow_reregistration',   existing.allow_reregistration,
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
