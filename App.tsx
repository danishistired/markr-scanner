import React, { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform } from 'react-native';

import { useFonts } from './src/lib/useFonts';
import { LoadingScreen } from './src/screens/LoadingScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { BlockedScreen } from './src/screens/BlockedScreen';
import { AlreadyRegisteredScreen } from './src/screens/AlreadyRegisteredScreen';
import { RequestPendingScreen } from './src/screens/RequestPendingScreen';
import { AdminScreen } from './src/screens/AdminScreen';

import { getDeviceFingerprint } from './src/lib/fingerprint';
import { getRegistration, saveRegistration } from './src/lib/storage';
import { supabase } from './src/lib/supabase';
import { AppScreen, RegistrationData } from './src/types';
import { isValidDeviceCheckResult, isInsecureContext } from './src/lib/security';

/**
 * Root component with state machine navigation.
 * Screens: loading → register | home → scanner | blocked | already_registered | request_pending | admin
 */
export default function App() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('loading');
  const [fingerprint, setFingerprint] = useState<string>('');
  const [registration, setRegistration] = useState<RegistrationData | null>(null);
  const [insecureCtx, setInsecureCtx] = useState(false);

  // Load DotGothic16 font
  const { fontsLoaded, fontError } = useFonts();

  // Boot sequence: fingerprint → check registration → set screen
  useEffect(() => {
    (async () => {
      try {
        // Direct route check for /admin on Web
        if (
          Platform.OS === 'web' &&
          typeof window !== 'undefined' &&
          (window.location.pathname === '/admin' ||
            window.location.pathname.endsWith('/admin') ||
            window.location.hash.includes('admin'))
        ) {
          setCurrentScreen('admin');
          return;
        }

        // OWASP A02: Warn on HTTP non-localhost contexts
        if (Platform.OS === 'web' && isInsecureContext()) {
          setInsecureCtx(true);
        }

        // 1. Get device fingerprint
        const fp = await getDeviceFingerprint();
        // Guard: reject empty fingerprint
        if (!fp || fp.length < 8) {
          setCurrentScreen('register');
          return;
        }
        setFingerprint(fp);

        // 2. Check local storage first for fast startup (pass fingerprint for decryption)
        const localReg = await getRegistration(fp);

        // 3. Check Supabase for authoritative state
        const { data, error } = await supabase.rpc('get_device_registration', {
          p_fingerprint: fp,
        });

        if (error) {
          // If we have local data, allow offline usage
          if (localReg) {
            setRegistration(localReg);
            setCurrentScreen('home');
          } else {
            setCurrentScreen('register');
          }
          return;
        }

        // OWASP A04: Runtime type validation before casting
        if (!isValidDeviceCheckResult(data)) {
          setCurrentScreen('register');
          return;
        }

        const result = data;

        if (result.registered) {
          if (result.blocked) {
            setCurrentScreen('blocked');
            return;
          }

          // Check if admin has unlocked re-registration for this device
          if (result.allow_reregistration) {
            // Admin unlocked -> go to register screen to allow new registration
            setCurrentScreen('register');
            return;
          }

          // Check if there is an active re-registration request ticket
          if (result.reregistration_request) {
            const reqStatus = result.reregistration_request.status;
            if (reqStatus === 'pending' || reqStatus === 'rejected') {
              setCurrentScreen('request_pending');
              return;
            }
            if (reqStatus === 'approved') {
              setCurrentScreen('register');
              return;
            }
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

          // Sync local data with server data (pass fingerprint for encryption)
          if (!localReg && result.data) {
            await saveRegistration(regData, fp);
          }

          setRegistration(regData);
          setCurrentScreen('home');
        } else {
          // Not registered — but may have a pending re-registration request
          // (e.g. UID conflict: device was never inserted but user submitted a request)
          if (result.reregistration_request) {
            const reqStatus = result.reregistration_request.status;
            if (reqStatus === 'pending' || reqStatus === 'rejected') {
              setCurrentScreen('request_pending');
              return;
            }
            if (reqStatus === 'approved') {
              setCurrentScreen('register');
              return;
            }
          }
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

  // Hold on loading screen until fonts are ready
  const isLoading = currentScreen === 'loading' || (!fontsLoaded && !fontError);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {isLoading && <LoadingScreen insecureContext={insecureCtx} />}
      {!isLoading && currentScreen === 'register' && (
        <RegisterScreen
          fingerprint={fingerprint}
          onNavigate={handleNavigate}
          insecureContext={insecureCtx}
        />
      )}
      {!isLoading && currentScreen === 'home' && registration && (
        <HomeScreen registration={registration} onNavigate={handleNavigate} />
      )}
      {!isLoading && currentScreen === 'scanner' && registration && (
        <ScannerScreen registration={registration} onNavigate={handleNavigate} />
      )}
      {!isLoading && currentScreen === 'blocked' && <BlockedScreen />}
      {!isLoading && currentScreen === 'already_registered' && (
        <AlreadyRegisteredScreen fingerprint={fingerprint} onNavigate={handleNavigate} />
      )}
      {!isLoading && currentScreen === 'request_pending' && (
        <RequestPendingScreen fingerprint={fingerprint} onNavigate={handleNavigate} />
      )}
      {!isLoading && currentScreen === 'admin' && (
        <AdminScreen onNavigate={handleNavigate} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
});
