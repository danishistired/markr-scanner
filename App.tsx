import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';

import { LoadingScreen } from './src/screens/LoadingScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { BlockedScreen } from './src/screens/BlockedScreen';

import { getDeviceFingerprint } from './src/lib/fingerprint';
import { getRegistration, saveRegistration } from './src/lib/storage';
import { supabase } from './src/lib/supabase';
import { AppScreen, RegistrationData, DeviceCheckResult } from './src/types';

/**
 * Root component with state machine navigation.
 * Screens: loading → register | scanner | blocked
 */
export default function App() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('loading');
  const [fingerprint, setFingerprint] = useState<string>('');
  const [registration, setRegistration] = useState<RegistrationData | null>(null);

  // Boot sequence: fingerprint → check registration → set screen
  useEffect(() => {
    (async () => {
      try {
        // 1. Get device fingerprint
        const fp = await getDeviceFingerprint();
        setFingerprint(fp);

        // 2. Check local storage first for fast startup
        const localReg = await getRegistration();

        // 3. Check Supabase for authoritative state
        const { data, error } = await supabase.rpc('get_device_registration', {
          p_fingerprint: fp,
        });

        if (error) {
          // If we have local data, allow offline usage
          if (localReg) {
            setRegistration(localReg);
            setCurrentScreen('scanner');
          } else {
            setCurrentScreen('register');
          }
          return;
        }

        const result = data as DeviceCheckResult;

        if (result.registered) {
          if (result.blocked) {
            setCurrentScreen('blocked');
            return;
          }

          // Device is registered and active
          const regData: RegistrationData = localReg || {
            student_name: result.data?.student_name ?? '',
            student_uid: result.data?.student_uid ?? '',
            student_email: result.data?.student_email ?? '',
            student_phone: result.data?.student_phone ?? '',
            student_section: result.data?.student_section ?? '',
            device_fingerprint: fp,
          };

          // Sync local data with server data
          if (!localReg && result.data) {
            await saveRegistration(regData);
          }

          setRegistration(regData);
          setCurrentScreen('scanner');
        } else {
          // Not registered
          setCurrentScreen('register');
        }
      } catch {
        // Fallback: if everything fails, go to register
        setCurrentScreen('register');
      }
    })();
  }, []);

  // Navigation handler passed to child screens
  const handleNavigate = useCallback(
    (screen: AppScreen, data?: RegistrationData) => {
      if (data) {
        setRegistration(data);
      }
      setCurrentScreen(screen);
    },
    []
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {currentScreen === 'loading' && <LoadingScreen />}
      {currentScreen === 'register' && (
        <RegisterScreen fingerprint={fingerprint} onNavigate={handleNavigate} />
      )}
      {currentScreen === 'scanner' && registration && (
        <ScannerScreen registration={registration} />
      )}
      {currentScreen === 'blocked' && <BlockedScreen />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
});
