/**
 * Application screen states for the state machine navigation.
 */
export type AppScreen =
  | 'loading'
  | 'register'
  | 'home'
  | 'scanner'
  | 'blocked'
  | 'already_registered'   // Device is locked — user needs admin approval
  | 'request_pending';     // Re-registration ticket submitted, waiting for admin

/**
 * Student registration data stored locally and in Supabase.
 * Note: is_otp_verified is intentionally optional — it is NOT stored to disk.
 * The server (Supabase RPC) is the authoritative source of truth.
 */
export interface RegistrationData {
  student_name: string;
  student_uid: string;
  student_email: string;
  student_phone: string;
  student_section: string;
  device_fingerprint: string;
  is_otp_verified?: boolean;
}

/**
 * Result from the get_device_registration RPC call.
 */
export interface DeviceCheckResult {
  registered: boolean;
  blocked?: boolean;
  allow_reregistration?: boolean;
  reregistration_request?: ReregistrationRequestStatus | null;
  data?: Record<string, string>;
  message?: string;
}

/**
 * Status of a re-registration request returned by get_device_registration
 * and get_reregistration_status.
 */
export interface ReregistrationRequestStatus {
  status: 'pending' | 'approved' | 'rejected';
  admin_notes?: string | null;
  created_at: string;
}

/**
 * Response from the QR validate API endpoint.
 */
export interface ValidateResponse {
  success: boolean;
  data?: {
    valid: boolean;
    message: string;
  };
  error?: string;
}

/**
 * QR scan result overlay state.
 */
export interface ScanResult {
  type: 'success' | 'error';
  message: string;
}
