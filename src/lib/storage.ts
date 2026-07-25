import * as SecureStore from 'expo-secure-store';
import { RegistrationData } from '../types';

const REGISTRATION_KEY = 'markr_registration_data';

/**
 * Save registration data to SecureStore as JSON.
 */
export async function saveRegistration(data: RegistrationData): Promise<void> {
  await SecureStore.setItemAsync(REGISTRATION_KEY, JSON.stringify(data));
}

/**
 * Read registration data from SecureStore.
 * Returns null if no registration is stored.
 */
export async function getRegistration(): Promise<RegistrationData | null> {
  const raw = await SecureStore.getItemAsync(REGISTRATION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as RegistrationData;
  } catch {
    return null;
  }
}

/**
 * Clear stored registration data.
 * Not exposed to UI — only for edge cases.
 */
export async function clearRegistration(): Promise<void> {
  await SecureStore.deleteItemAsync(REGISTRATION_KEY);
}
