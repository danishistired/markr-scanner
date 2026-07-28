import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getWebCryptoDeviceSignature } from './crypto';

const FINGERPRINT_KEY = 'markr_device_fingerprint';

/**
 * On Web/PWA, the canonical store is IndexedDB (managed by crypto.ts).
 * localStorage is NOT used as a fingerprint cache for web — that would create
 * a stale duplicate that diverges from IndexedDB on subsequent launches.
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
    // Web / PWA: Web Crypto API + IndexedDB persistence (fully managed by crypto.ts)
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
 * Get the device fingerprint.
 *
 * Web/PWA:
 *   → Always delegates to getWebCryptoDeviceSignature() which handles its own
 *     IndexedDB caching. No localStorage involved (avoids stale-copy divergence bug).
 *
 * Native (iOS/Android):
 *   → Reads from SecureStore; computes from hardware if missing.
 */
export async function getDeviceFingerprint(): Promise<string> {
  // Web: fully delegated to crypto.ts (IndexedDB cache is inside getWebCryptoDeviceSignature)
  if (Platform.OS === 'web') {
    const sig = await getWebCryptoDeviceSignature();
    // Guard: reject empty or error-state signatures — force a fresh recompute
    if (!sig || sig.startsWith('pwa_err_') || sig.length < 20) {
      // Clear the bad cached value and try once more
      try {
        const { clearCryptoCache } = await import('./crypto');
        await clearCryptoCache();
      } catch {
        // clearCryptoCache may not be available in all builds
      }
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
