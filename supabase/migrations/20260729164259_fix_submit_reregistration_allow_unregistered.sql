-- Fix submit_reregistration_request: allow requests from devices
-- that aren't in device_registrations yet (e.g. when UID was already
-- taken by another device, the current device was never inserted).
-- Only block requests from explicitly blocked devices.

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
  -- Sanitise reason length
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
