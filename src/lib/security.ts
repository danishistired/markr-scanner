/**
 * Input Sanitization & Validation Utilities
 *
 * OWASP A03 — Injection Prevention
 * Strips dangerous characters, enforces max lengths, validates formats.
 */

/** Strip control characters and null bytes from any string input */
function stripDangerous(value: string): string {
  // Remove null bytes, control chars (except \t\n), and common injection vectors
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/** Enforce max length, strip dangerous chars */
function sanitizeField(value: string, maxLen: number): string {
  return stripDangerous(value).slice(0, maxLen);
}

export const Sanitize = {
  /** Student full name — alpha, spaces, hyphens only */
  name(raw: string): string {
    return sanitizeField(raw, 100).replace(/[^a-zA-Z\s'-]/g, '');
  },

  /** Student UID / roll number — alphanumeric + hyphens */
  uid(raw: string): string {
    return sanitizeField(raw, 40).replace(/[^a-zA-Z0-9/_-]/g, '');
  },

  /** Email address — standard email chars only */
  email(raw: string): string {
    return sanitizeField(raw, 254).replace(/[^a-zA-Z0-9._%+\-@]/g, '');
  },

  /** Phone number — digits, +, spaces, dashes only */
  phone(raw: string): string {
    return sanitizeField(raw, 20).replace(/[^+\d\s-]/g, '');
  },

  /** Section — 1-4 alphanumeric chars */
  section(raw: string): string {
    return sanitizeField(raw, 10).replace(/[^a-zA-Z0-9]/g, '');
  },

  /**
   * QR token — OWASP A03: reject tokens that are too long or contain
   * suspicious characters. QR tokens should be opaque strings.
   * Returns null if token fails validation.
   */
  qrToken(raw: string): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const cleaned = stripDangerous(raw);
    // Reject oversized payloads (> 2048 chars) — standard QR max is ~4296 but API tokens are short
    if (cleaned.length > 2048 || cleaned.length < 4) return null;
    // Allow only URL-safe characters and common token formats
    if (!/^[\w\-.~+/=:@%]+$/.test(cleaned)) return null;
    return cleaned;
  },

  /** OTP code — exactly 6 digits */
  otpCode(raw: string): string | null {
    const cleaned = raw.replace(/\D/g, '').slice(0, 6);
    if (cleaned.length !== 6) return null;
    return cleaned;
  },
};

/**
 * Runtime type guard for Supabase/API response shapes.
 * OWASP A04 — Insecure Design: never blindly cast API responses.
 */
export function isValidRegisterResult(data: unknown): data is {
  success: boolean;
  already_registered?: boolean;
  error?: string;
  message?: string;
  data?: Record<string, unknown>;
} {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.success === 'boolean';
}

export function isValidDeviceCheckResult(data: unknown): data is {
  registered: boolean;
  blocked?: boolean;
  allow_reregistration?: boolean;
  reregistration_request?: { status: string; admin_notes?: string | null; created_at: string } | null;
  data?: Record<string, string>;
  message?: string;
} {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.registered === 'boolean';
}

/**
 * Type guard for submit_reregistration_request RPC response.
 */
export function isValidSubmitRequestResult(data: unknown): data is {
  success: boolean;
  error?: string;
  request_id?: string;
  created_at?: string;
} {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.success === 'boolean';
}

/**
 * Type guard for get_reregistration_status RPC response.
 */
export function isValidReregistrationStatus(data: unknown): data is {
  has_request: boolean;
  status?: 'pending' | 'approved' | 'rejected';
  admin_notes?: string | null;
  created_at?: string;
} {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.has_request === 'boolean';
}

export function isValidValidateResponse(data: unknown): data is {
  success: boolean;
  data?: { valid: boolean; message: string };
  error?: string;
} {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.success === 'boolean';
}

/**
 * Detect insecure (non-HTTPS) context.
 * OWASP A02 — Cryptographic Failures: WebCrypto requires secure context.
 */
export function isInsecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location?.protocol === 'http:' && window.location?.hostname !== 'localhost';
}
