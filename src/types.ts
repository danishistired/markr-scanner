/**
 * Application screen states for the state machine navigation.
 */
export type AppScreen = 'loading' | 'register' | 'home' | 'scanner' | 'blocked';

/**
 * Student registration data stored locally and in Supabase.
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
 * Result from the register_device RPC call.
 */
export interface RegisterDeviceResult {
  success: boolean;
  already_registered?: boolean;
  error?: string;
  message?: string;
  data?: Record<string, unknown>;
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

/**
 * OTP Verification State
 */
export interface OTPState {
  sent: boolean;
  code: string;
  verified: boolean;
  error?: string;
}
