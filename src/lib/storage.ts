/**
 * AES-GCM Encrypted Storage Module
 *
 * OWASP A02 — Cryptographic Failures: Fixes plaintext localStorage
 * All registration data on Web/PWA is encrypted with AES-GCM 256-bit
 * before being written to localStorage. The encryption key is derived
 * from the device fingerprint using PBKDF2.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { RegistrationData } from '../types';

const REGISTRATION_KEY = 'markr_registration_data';
const SALT_KEY = 'markr_enc_salt';
const PBKDF2_ITERATIONS = 100_000;

/** Convert ArrayBuffer or Uint8Array to base64 — safe for any size (no spread) */
function toBase64(buffer: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1024) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 1024));
  }
  return btoa(binary);
}

/** Convert base64 string to Uint8Array */
function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Derive an AES-GCM key from the device fingerprint using PBKDF2.
 * Uses a random salt stored alongside the ciphertext.
 */
async function deriveKey(fingerprint: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(fingerprint),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a string with AES-GCM. Returns base64-encoded payload.
 * Format: base64(salt)||.||base64(iv)||.||base64(ciphertext)
 */
async function encryptString(plaintext: string, fingerprint: string): Promise<string> {
  const encoder = new TextEncoder();
  // Cast to Uint8Array<ArrayBuffer> — crypto.getRandomValues returns ArrayBufferLike
  // which TypeScript 5.x doesn't accept as BufferSource without explicit narrowing
  const salt = crypto.getRandomValues(new Uint8Array(16)) as unknown as Uint8Array<ArrayBuffer>;
  const iv = crypto.getRandomValues(new Uint8Array(12)) as unknown as Uint8Array<ArrayBuffer>;
  const key = await deriveKey(fingerprint, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );

  return `${toBase64(salt)}.${toBase64(iv)}.${toBase64(ciphertext)}`;
}

/**
 * Decrypt an AES-GCM encrypted payload. Returns null on failure.
 */
async function decryptString(payload: string, fingerprint: string): Promise<string | null> {
  try {
    const parts = payload.split('.');
    if (parts.length !== 3) return null;

    const salt = fromBase64(parts[0]) as unknown as Uint8Array<ArrayBuffer>;
    const iv = fromBase64(parts[1]) as unknown as Uint8Array<ArrayBuffer>;
    const ciphertext = fromBase64(parts[2]) as unknown as Uint8Array<ArrayBuffer>;

    const key = await deriveKey(fingerprint, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/**
 * Check if Web Crypto is available for encryption.
 * On older browsers or HTTP contexts, fall back to sessionStorage (in-memory only).
 */
function canEncrypt(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof btoa !== 'undefined'
  );
}

/**
 * Save registration data.
 * Web: AES-GCM encrypted in localStorage (keyed to device fingerprint).
 * Native: expo-secure-store (OS keychain).
 */
export async function saveRegistration(
  data: RegistrationData,
  fingerprint?: string
): Promise<void> {
  // Strip is_otp_verified from stored payload — server is source of truth (OWASP A04)
  const { is_otp_verified: _stripped, ...safeData } = data;
  void _stripped;
  const jsonString = JSON.stringify(safeData);

  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage === 'undefined') return;

      if (canEncrypt() && fingerprint) {
        // Encrypted storage (OWASP A02 fix)
        const encrypted = await encryptString(jsonString, fingerprint);
        localStorage.setItem(REGISTRATION_KEY, encrypted);
        localStorage.setItem(SALT_KEY, fingerprint.slice(0, 16)); // version tag only
      } else {
        // Fallback: sessionStorage only (not persisted across browser close)
        sessionStorage.setItem(REGISTRATION_KEY, jsonString);
      }
    } catch {
      // Quota exceeded or private browsing restriction
    }
    return;
  }

  try {
    await SecureStore.setItemAsync(REGISTRATION_KEY, jsonString);
  } catch {
    // Native secure store save error
  }
}

/**
 * Read registration data.
 * Attempts AES-GCM decryption on web; falls back to sessionStorage.
 */
export async function getRegistration(fingerprint?: string): Promise<RegistrationData | null> {
  let raw: string | null = null;

  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage === 'undefined') return null;

      const encrypted = localStorage.getItem(REGISTRATION_KEY);
      if (encrypted) {
        if (canEncrypt() && fingerprint) {
          // Attempt decryption
          raw = await decryptString(encrypted, fingerprint);
          if (!raw) {
            // Decryption failed — fingerprint mismatch or corrupt data
            localStorage.removeItem(REGISTRATION_KEY);
            return null;
          }
        } else {
          // Check if it's plaintext JSON (migration path from v1)
          if (encrypted.startsWith('{')) {
            raw = encrypted;
          }
        }
      }

      // Fallback: sessionStorage
      if (!raw) {
        raw = sessionStorage.getItem(REGISTRATION_KEY);
      }
    } catch {
      raw = null;
    }
  } else {
    try {
      raw = await SecureStore.getItemAsync(REGISTRATION_KEY);
    } catch {
      raw = null;
    }
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as RegistrationData;
    // Validate parsed object has required fields (OWASP A04 — type safety)
    if (
      typeof parsed.student_name !== 'string' ||
      typeof parsed.student_uid !== 'string' ||
      typeof parsed.device_fingerprint !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Clear all stored registration data.
 */
export async function clearRegistration(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      localStorage.removeItem(REGISTRATION_KEY);
      localStorage.removeItem(SALT_KEY);
      sessionStorage.removeItem(REGISTRATION_KEY);
    } catch {
      // Ignore
    }
    return;
  }

  try {
    await SecureStore.deleteItemAsync(REGISTRATION_KEY);
  } catch {
    // Ignore
  }
}
