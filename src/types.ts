/**
 * Application screen states for the state machine navigation.
 */
export type AppScreen = 'loading' | 'register' | 'home' | 'scanner' | 'blocked';

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
  data?: Record<string, string>;
  message?: string;
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
