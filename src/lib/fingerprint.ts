import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const FINGERPRINT_KEY = 'markr_device_fingerprint';

/**
 * Compute a SHA-256 device fingerprint from hardware signals.
 * Uses platform-specific persistent identifiers where available.
 */
async function computeFingerprint(): Promise<string> {
  const signals: string[] = [];

  if (Platform.OS === 'android') {
    // android_id persists across installs (resets on factory reset)
    const androidId = Application.getAndroidId();
    if (androidId) signals.push(androidId);
  }

  if (Platform.OS === 'ios') {
    // identifierForVendor persists across installs from same vendor
    const iosId = await Application.getIosIdForVendorAsync();
    if (iosId) signals.push(iosId);
  }

  // Fallback hardware signals
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
 * - On first launch: computes from hardware signals, stores in SecureStore.
 * - On subsequent launches: reads from SecureStore.
 * - If SecureStore is empty (app reinstalled on Android): recomputes and stores.
 */
export async function getDeviceFingerprint(): Promise<string> {
  // Try to read cached fingerprint first
  const cached = await SecureStore.getItemAsync(FINGERPRINT_KEY);
  if (cached) {
    return cached;
  }

  // Compute fresh fingerprint
  const fingerprint = await computeFingerprint();

  // Persist for future launches
  await SecureStore.setItemAsync(FINGERPRINT_KEY, fingerprint);

  return fingerprint;
}
