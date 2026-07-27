import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getWebCryptoDeviceSignature } from './crypto';

const FINGERPRINT_KEY = 'markr_device_fingerprint';

/**
 * Safe helper to read from SecureStore with web/SSR fallback.
 */
async function getStoredFingerprint(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(FINGERPRINT_KEY);
      }
      return null;
    }
    return await SecureStore.getItemAsync(FINGERPRINT_KEY);
  } catch {
    return null;
  }
}

/**
 * Safe helper to save to SecureStore with web fallback.
 */
async function setStoredFingerprint(value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FINGERPRINT_KEY, value);
      }
      return;
    }
    await SecureStore.setItemAsync(FINGERPRINT_KEY, value);
  } catch {
    // Ignore storage errors on restricted environments
  }
}

/**
 * Compute a SHA-256 device fingerprint from hardware signals.
 * Uses platform-specific persistent identifiers where available.
 * On Web / iOS Safari PWA: Uses Web Crypto API + IndexedDB persistence key pair (Option 1).
 */
async function computeFingerprint(): Promise<string> {
  // If running on Web / PWA, use Web Crypto API signature (Option 1)
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

  // Fallback hardware signals for native mobile app
  signals.push(Device.modelName ?? 'unknown_model');
  signals.push(Device.brand ?? 'unknown_brand');
  signals.push(Device.osVersion ?? 'unknown_os');
  signals.push(Device.totalMemory?.toString() ?? '0');

  const raw = signals.join('|');
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    raw
  );

  return hash;
}

/**
 * Get the device fingerprint.
 * - On Web / PWA: Obtains or recovers Web Crypto API signature stored in IndexedDB.
 * - On Native mobile: Reads from SecureStore or computes from hardware signals.
 */
export async function getDeviceFingerprint(): Promise<string> {
  // Try to read cached fingerprint first
  const cached = await getStoredFingerprint();
  if (cached) {
    return cached;
  }

  // Compute fresh fingerprint or Web Crypto signature
  const fingerprint = await computeFingerprint();

  // Persist for future launches
  await setStoredFingerprint(fingerprint);

  return fingerprint;
}
