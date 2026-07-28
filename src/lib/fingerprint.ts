import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getWebCryptoDeviceSignature, clearCryptoCache } from './crypto';

const FINGERPRINT_KEY = 'markr_device_fingerprint';

/**
 * On Web/PWA, the canonical store is IndexedDB (managed by crypto.ts).
 * No localStorage is used for the fingerprint on web — that caused a
 * stale-copy divergence bug where localStorage held an old value that
 * diverged from the IndexedDB copy on subsequent launches.
 *
 * On native (iOS/Android), SecureStore is the canonical store.
 */

/**
 * Read from SecureStore (native only).
 */
async function getNativeFingerprint(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(FINGERPRINT_KEY);
  } catch {
    return null;
  }
}

/**
 * Save to SecureStore (native only).
 */
async function setNativeFingerprint(value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(FINGERPRINT_KEY, value);
  } catch {
    // Ignore
  }
}

/**
 * Compute a SHA-256 device fingerprint from hardware signals (native).
 * On web, delegates entirely to the Web Crypto API module (crypto.ts).
 */
async function computeFingerprint(): Promise<string> {
  if (Platform.OS === 'web') {
    return await getWebCryptoDeviceSignature();
  }

  const signals: string[] = [];

  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId();
    if (androidId) signals.push(androidId);
  }

  if (Platform.OS === 'ios') {
    const iosId = await Application.getIosIdForVendorAsync();
    if (iosId) signals.push(iosId);
  }

  signals.push(Device.modelName ?? 'unknown_model');
  signals.push(Device.brand ?? 'unknown_brand');
  signals.push(Device.osVersion ?? 'unknown_os');
  signals.push(Device.totalMemory?.toString() ?? '0');

  const raw = signals.join('|');
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
}

/**
 * Check if a signature is a valid, fully-derived web crypto signature.
 * Must be: 'pwa_' prefix + 64-char SHA-256 hex = exactly 68 chars.
 * Rejects error-state fallbacks (pwa_err_, pwa_fb_).
 */
function isGoodSignature(sig: string): boolean {
  if (!sig.startsWith('pwa_') || sig.length < 68) return false;
  if (sig.startsWith('pwa_err_') || sig.startsWith('pwa_fb_')) return false;
  return true;
}

/**
 * Get the device fingerprint.
 *
 * Web/PWA:
 *   → Delegates to getWebCryptoDeviceSignature() (IndexedDB-cached).
 *   → If the returned signature is an error/fallback state, clears the
 *     IndexedDB cache (static import of clearCryptoCache — NOT dynamic import)
 *     and retries once. Returns the result regardless.
 *
 * Native (iOS/Android):
 *   → Reads from SecureStore; computes from hardware if missing.
 */
export async function getDeviceFingerprint(): Promise<string> {
  if (Platform.OS === 'web') {
    const sig = await getWebCryptoDeviceSignature();

    if (!isGoodSignature(sig)) {
      // Clear the bad cached value and try once more (static import — always available)
      try {
        await clearCryptoCache();
      } catch {
        // Best effort — clearCryptoCache itself won't throw but guard anyway
      }
      // Return result of retry regardless — if still an error state, App.tsx guards it
      return await getWebCryptoDeviceSignature();
    }

    return sig;
  }

  // Native: SecureStore-backed cache
  const cached = await getNativeFingerprint();
  if (cached && cached.length >= 16) {
    return cached;
  }

  const fingerprint = await computeFingerprint();
  await setNativeFingerprint(fingerprint);
  return fingerprint;
}
