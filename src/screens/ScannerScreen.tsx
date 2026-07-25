import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { RegistrationData, ScanResult, ValidateResponse } from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL!;
const DEBOUNCE_MS = 5000;
const RESULT_DISPLAY_MS = 3000;
const FADE_DURATION_MS = 200;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ScannerScreenProps {
  registration: RegistrationData;
}

/**
 * QR Scanner screen.
 * Full-screen camera with result overlays and debounced scanning.
 */
export function ScannerScreen({ registration }: ScannerScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Debounce tracking
  const lastScanRef = useRef<{ data: string; time: number } | null>(null);

  // Result overlay animation
  const overlayTranslateY = useRef(new Animated.Value(120)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  // Auto-dismiss timer
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Request camera permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const showResult = useCallback(
    (result: ScanResult) => {
      setScanResult(result);

      // Slide up + fade in
      overlayTranslateY.setValue(120);
      overlayOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(overlayTranslateY, {
          toValue: 0,
          duration: FADE_DURATION_MS,
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: FADE_DURATION_MS,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss after 3 seconds
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(overlayTranslateY, {
            toValue: 120,
            duration: FADE_DURATION_MS,
            useNativeDriver: true,
          }),
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration: FADE_DURATION_MS,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setScanResult(null);
          setIsProcessing(false);
        });
      }, RESULT_DISPLAY_MS);
    },
    [overlayTranslateY, overlayOpacity]
  );

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (isProcessing) return;

      // Debounce: ignore same QR data within 5 seconds
      const now = Date.now();
      if (
        lastScanRef.current &&
        lastScanRef.current.data === data &&
        now - lastScanRef.current.time < DEBOUNCE_MS
      ) {
        return;
      }

      lastScanRef.current = { data, time: now };
      setIsProcessing(true);

      try {
        const response = await fetch(`${API_BASE_URL}/api/qr/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: data,
            name: registration.student_name,
            uid: registration.student_uid,
            email: registration.student_email,
            phone: registration.student_phone,
            section: registration.student_section,
          }),
        });

        const json: ValidateResponse = await response.json();

        if (json.success && json.data) {
          if (json.data.valid) {
            showResult({ type: 'success', message: json.data.message || 'attendance marked!' });
          } else {
            showResult({ type: 'error', message: json.data.message || 'validation failed' });
          }
        } else {
          showResult({ type: 'error', message: json.error || 'validation failed' });
        }
      } catch {
        showResult({ type: 'error', message: 'connection error, try again' });
      }
    },
    [isProcessing, registration, showResult]
  );

  // Camera permission states
  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>requesting camera access...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionTitle}>camera access required</Text>
        <Text style={styles.permissionText}>
          markr needs camera access to scan QR codes.{'\n'}
          enable it in your device settings.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Full-screen camera */}
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={isProcessing ? undefined : handleBarCodeScanned}
      />

      {/* Top-right markr branding */}
      <View style={styles.topBranding}>
        <Text style={styles.topBrandingText}>markr</Text>
      </View>

      {/* Bottom info bar */}
      <View style={styles.bottomBar}>
        <Text style={styles.bottomBarName} numberOfLines={1}>
          {registration.student_name}
        </Text>
        <Text style={styles.bottomBarUid}>{registration.student_uid}</Text>
      </View>

      {/* Result overlay */}
      {scanResult && (
        <Animated.View
          style={[
            styles.resultOverlay,
            {
              backgroundColor:
                scanResult.type === 'success' ? '#22C55E' : '#EF4444',
              transform: [{ translateY: overlayTranslateY }],
              opacity: overlayOpacity,
            },
          ]}
        >
          <Text style={styles.resultIcon}>
            {scanResult.type === 'success' ? '✓' : '✕'}
          </Text>
          <Text style={styles.resultMessage}>{scanResult.message}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  camera: {
    flex: 1,
  },
  // Permission states
  permissionTitle: {
    fontFamily: 'monospace',
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
    marginTop: 'auto',
    letterSpacing: 1,
  },
  permissionText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 'auto',
    marginTop: 8,
    paddingHorizontal: 32,
    letterSpacing: 0.5,
  },
  // Top branding
  topBranding: {
    position: 'absolute',
    top: 56,
    right: 16,
  },
  topBrandingText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.35)',
    letterSpacing: 2,
  },
  // Bottom info bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 48,
    backgroundColor: '#18181B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#27272A',
  },
  bottomBarName: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#FFFFFF',
    flex: 1,
    marginRight: 12,
    letterSpacing: 0.5,
  },
  bottomBarUid: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#71717A',
    letterSpacing: 0.5,
  },
  // Result overlay
  resultOverlay: {
    position: 'absolute',
    bottom: 48, // Above the bottom bar
    left: 0,
    right: 0,
    height: 120,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 16,
  },
  resultIcon: {
    fontFamily: 'monospace',
    fontSize: 28,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  resultMessage: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#FFFFFF',
    flex: 1,
    letterSpacing: 0.5,
    lineHeight: 20,
  },
});
