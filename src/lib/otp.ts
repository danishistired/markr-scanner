/**
 * HMAC-SHA256 Time-Based OTP Module
 *
 * OWASP A07 — Authentication Failures: Fixes
 *   - OTP is no longer hardcoded as "123456"
 *   - OTP is generated using HMAC-SHA256 (Web Crypto API) with a time-window seed
 *   - OTP has a strict 5-minute expiry window
 *   - Max 3 failed attempts before 30-second lockout
 *   - No code ever logged to console
 *
 * IMPORTANT: For production, OTP generation and verification MUST move server-side
 * (e.g. Supabase Edge Function / backend). This client-side TOTP is a significant
 * improvement over hardcoded "123456" but is not a substitute for server-side OTP.
 */

/** OTP time window in milliseconds (5 minutes) */
const OTP_WINDOW_MS = 5 * 60 * 1000;
const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 30 * 1000;

export interface OTPSession {
  /** HMAC-generated OTP hash (never store raw code) */
  hash: string;
  /** Unix timestamp when this OTP was issued */
  issuedAt: number;
  /** Number of failed verification attempts */
  attempts: number;
  /** Timestamp when lockout expires (0 if not locked out) */
  lockedUntil: number;
}

/**
 * Derive an HMAC-SHA256 key from a seed string.
 */
async function deriveHmacKey(seed: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(seed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  return keyMaterial;
}

/**
 * Generate a 6-digit HMAC-based OTP.
 * Seed = phone + deviceFingerprint + time-window slot.
 * This ties the OTP to both the phone number AND the specific device.
 *
 * Returns the OTP hash (SHA-256 of the HMAC output) for storage.
 * The raw code is only returned once and must not be persisted.
 */
export async function generateOTP(
  phone: string,
  fingerprint: string
): Promise<{ code: string; session: OTPSession }> {
  const now = Date.now();
  const timeSlot = Math.floor(now / OTP_WINDOW_MS); // Changes every 5 min

  // Seed ties OTP to phone + device + time window
  const seed = `${phone.replace(/\s/g, '')}:${fingerprint}:markr`;
  const message = `${timeSlot}`;

  const key = await deriveHmacKey(seed);
  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message));

  // Derive 6-digit code from HMAC output (HOTP-style truncation)
  const hmacBytes = new Uint8Array(signatureBuffer);
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const code32 =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);
  const rawCode = (code32 % 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');

  // Hash the code before storing (never store raw OTP)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawCode + seed));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    code: rawCode, // Show to user only — NEVER persist this
    session: {
      hash: hashHex,
      issuedAt: now,
      attempts: 0,
      lockedUntil: 0,
    },
  };
}

export interface VerifyResult {
  valid: boolean;
  reason?: 'invalid_code' | 'expired' | 'locked' | 'max_attempts';
  updatedSession: OTPSession;
}

/**
 * Verify a user-entered OTP code against the stored session.
 * Enforces expiry and attempt limits.
 */
export async function verifyOTP(
  enteredCode: string,
  session: OTPSession,
  phone: string,
  fingerprint: string
): Promise<VerifyResult> {
  const now = Date.now();

  // Check lockout
  if (session.lockedUntil > now) {
    return { valid: false, reason: 'locked', updatedSession: session };
  }

  // Check expiry (5-minute window)
  if (now - session.issuedAt > OTP_WINDOW_MS) {
    return { valid: false, reason: 'expired', updatedSession: session };
  }

  // Max attempts guard
  if (session.attempts >= MAX_ATTEMPTS) {
    const locked: OTPSession = { ...session, lockedUntil: now + LOCKOUT_MS };
    return { valid: false, reason: 'max_attempts', updatedSession: locked };
  }

  // Re-derive the expected hash from what the code would have been
  const seed = `${phone.replace(/\s/g, '')}:${fingerprint}:markr`;
  const encoder = new TextEncoder();
  const expectedHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(enteredCode + seed)
  );
  const expectedHash = Array.from(new Uint8Array(expectedHashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const isValid = expectedHash === session.hash;

  if (!isValid) {
    const newAttempts = session.attempts + 1;
    const updatedSession: OTPSession = {
      ...session,
      attempts: newAttempts,
      lockedUntil: newAttempts >= MAX_ATTEMPTS ? now + LOCKOUT_MS : 0,
    };
    return {
      valid: false,
      reason: newAttempts >= MAX_ATTEMPTS ? 'max_attempts' : 'invalid_code',
      updatedSession,
    };
  }

  return { valid: true, updatedSession: { ...session, attempts: 0 } };
}

/** Remaining OTP expiry in seconds. Returns 0 if expired. */
export function otpSecondsRemaining(session: OTPSession): number {
  const elapsed = Date.now() - session.issuedAt;
  const remaining = Math.max(0, OTP_WINDOW_MS - elapsed);
  return Math.floor(remaining / 1000);
}

/** Lockout cooldown in seconds. Returns 0 if not locked. */
export function lockoutSecondsRemaining(session: OTPSession): number {
  const remaining = Math.max(0, session.lockedUntil - Date.now());
  return Math.floor(remaining / 1000);
}
