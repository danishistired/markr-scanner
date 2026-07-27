import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { RegistrationData } from '../types';

const REGISTRATION_KEY = 'markr_registration_data';

/**
 * Save registration data to SecureStore (or localStorage on Web PWA).
 */
export async function saveRegistration(data: RegistrationData): Promise<void> {
  const jsonString = JSON.stringify(data);

  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(REGISTRATION_KEY, jsonString);
      }
    } catch {
      // Storage quotas or restricted mode
    }
    return;
  }

  try {
    await SecureStore.setItemAsync(REGISTRATION_KEY, jsonString);
  } catch {
    // Ignore native secure store save errors
  }
}

/**
 * Read registration data from SecureStore (or localStorage on Web PWA).
 * Returns null if no registration is stored.
 */
export async function getRegistration(): Promise<RegistrationData | null> {
  let raw: string | null = null;

  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(REGISTRATION_KEY);
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
    return JSON.parse(raw) as RegistrationData;
  } catch {
    return null;
  }
}

/**
 * Clear stored registration data.
 */
export async function clearRegistration(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(REGISTRATION_KEY);
      }
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
