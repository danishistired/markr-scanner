import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Easing,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { RegistrationData, ScanResult, ValidateResponse, AppScreen } from '../types';
import { Sanitize, isValidValidateResponse } from '../lib/security';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL!;
const DEBOUNCE_MS = 5000;
const RESULT_DISPLAY_MS = 3500;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const VIEWFINDER_SIZE = SCREEN_WIDTH * 0.65;

interface ScannerScreenProps {
  registration: RegistrationData;
  onNavigate: (screen: AppScreen) => void;
}

/**
 * QR Scanner screen with premium motion animations.
 * Full-screen camera with animated viewfinder, and full-screen
 * result overlays (PayTM-style) for success/error/connection states.
 */
export function ScannerScreen({ registration, onNavigate }: ScannerScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showResultOverlay, setShowResultOverlay] = useState(false);

  // Debounce tracking
  const lastScanRef = useRef<{ data: string; time: number } | null>(null);

  // ── Viewfinder scanning animation ────────────────────────────
  const scanLinePosition = useRef(new Animated.Value(0)).current;
  const scanLinePulse = useRef(new Animated.Value(0.6)).current;
  const cornerPulse = useRef(new Animated.Value(1)).current;

  // ── Result overlay animations ────────────────────────────────
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const overlayScale = useRef(new Animated.Value(0.8)).current;
  const iconScale = useRef(new Animated.Value(0)).current;
  const iconRotation = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(1)).current;
  const ring2Scale = useRef(new Animated.Value(0)).current;
  const ring2Opacity = useRef(new Animated.Value(1)).current;
  const messageOpacity = useRef(new Animated.Value(0)).current;
  const messageTranslateY = useRef(new Animated.Value(20)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Auto-dismiss timer
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Request camera permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Scanning line animation loop
  useEffect(() => {
    const scanAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLinePosition, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanLinePosition, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLinePulse, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(scanLinePulse, {
          toValue: 0.4,
          duration: 1100,
          useNativeDriver: true,
        }),
      ])
    );

    const cornerAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(cornerPulse, {
          toValue: 0.6,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(cornerPulse, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    scanAnim.start();
    pulseAnim.start();
    cornerAnim.start();

    return () => {
      scanAnim.stop();
      pulseAnim.stop();
      cornerAnim.stop();
    };
  }, [scanLinePosition, scanLinePulse, cornerPulse]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const resetOverlayAnimations = useCallback(() => {
    overlayOpacity.setValue(0);
    overlayScale.setValue(0.8);
    iconScale.setValue(0);
    iconRotation.setValue(0);
    ringScale.setValue(0);
    ringOpacity.setValue(1);
    ring2Scale.setValue(0);
    ring2Opacity.setValue(1);
    messageOpacity.setValue(0);
    messageTranslateY.setValue(20);
    shakeAnim.setValue(0);
  }, [overlayOpacity, overlayScale, iconScale, iconRotation, ringScale, ringOpacity, ring2Scale, ring2Opacity, messageOpacity, messageTranslateY, shakeAnim]);

  const animateSuccess = useCallback(() => {
    // Overlay fade in
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(overlayScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Icon bounces in
    setTimeout(() => {
      Animated.spring(iconScale, {
        toValue: 1,
        friction: 4,
        tension: 50,
        useNativeDriver: true,
      }).start();
    }, 200);

    // Expanding ripple rings
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: 3,
          duration: 800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start();
    }, 350);

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(ring2Scale, {
          toValue: 3.5,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ring2Opacity, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ]).start();
    }, 550);

    // Message slides up
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(messageOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(messageTranslateY, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    }, 500);
  }, [overlayOpacity, overlayScale, iconScale, ringScale, ringOpacity, ring2Scale, ring2Opacity, messageOpacity, messageTranslateY]);

  const animateError = useCallback(() => {
    // Overlay fade in
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(overlayScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Icon pops in then shakes
    setTimeout(() => {
      Animated.spring(iconScale, {
        toValue: 1,
        friction: 5,
        tension: 60,
        useNativeDriver: true,
      }).start(() => {
        // Shake sequence
        Animated.sequence([
          Animated.timing(shakeAnim, { toValue: 15, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -15, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -12, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 8, duration: 40, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -8, duration: 40, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
        ]).start();
      });
    }, 200);

    // Red pulse ring
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: 2.5,
          duration: 600,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start();
    }, 400);

    // Message slides up
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(messageOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(messageTranslateY, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    }, 500);
  }, [overlayOpacity, overlayScale, iconScale, shakeAnim, ringScale, ringOpacity, messageOpacity, messageTranslateY]);

  const showResult = useCallback(
    (result: ScanResult) => {
      setScanResult(result);
      setShowResultOverlay(true);
      resetOverlayAnimations();

      if (result.type === 'success') {
        animateSuccess();
      } else {
        animateError();
      }

      // Auto-dismiss
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(overlayScale, {
            toValue: 0.9,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setShowResultOverlay(false);
          setScanResult(null);
          setIsProcessing(false);
        });
      }, RESULT_DISPLAY_MS);
    },
    [resetOverlayAnimations, animateSuccess, animateError, overlayOpacity, overlayScale]
  );

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (isProcessing) return;

      // OWASP A03: Sanitize and validate QR token before any processing
      const sanitizedToken = Sanitize.qrToken(data);
      if (!sanitizedToken) {
        // Silently ignore malformed/oversized QR codes
        return;
      }

      // Debounce: ignore same QR data within 5 seconds
      const now = Date.now();
      if (
        lastScanRef.current &&
        lastScanRef.current.data === sanitizedToken &&
        now - lastScanRef.current.time < DEBOUNCE_MS
      ) {
        return;
      }

      lastScanRef.current = { data: sanitizedToken, time: now };
      setIsProcessing(true);

      try {
        const response = await fetch(`${API_BASE_URL}/api/qr/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: sanitizedToken,
            // OWASP A01: Bind device fingerprint to every scan — server can verify
            device_fingerprint: registration.device_fingerprint,
            uid: registration.student_uid,
            section: registration.student_section,
          }),
        });

        if (!response.ok) {
          showResult({ type: 'error', message: 'server error · try again' });
          return;
        }

        const rawJson: unknown = await response.json();

        // OWASP A04: Runtime type guard — never blindly trust API shape
        if (!isValidValidateResponse(rawJson)) {
          showResult({ type: 'error', message: 'unexpected server response' });
          return;
        }

        const json = rawJson as ValidateResponse;

        if (json.success && json.data) {
          if (json.data.valid) {
            showResult({ type: 'success', message: json.data.message || 'attendance marked!' });
          } else {
            showResult({ type: 'error', message: json.data.message || 'validation failed' });
          }
        } else {
          showResult({ type: 'error', message: 'validation failed' });
        }
      } catch {
        showResult({ type: 'error', message: 'connection error · check your network' });
      }
    },
    [isProcessing, registration, showResult]
  );

  // Interpolate scan line position
  const scanLineTranslateY = scanLinePosition.interpolate({
    inputRange: [0, 1],
    outputRange: [0, VIEWFINDER_SIZE - 4],
  });

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

      {/* Dark overlay with viewfinder cutout effect */}
      <View style={styles.overlayContainer} pointerEvents="box-none">
        {/* Top dark region */}
        <View style={styles.overlayDarkTop} />

        {/* Middle row: dark | viewfinder | dark */}
        <View style={styles.overlayMiddleRow}>
          <View style={styles.overlayDarkSide} />

          {/* Viewfinder area */}
          <View style={styles.viewfinder}>
            {/* Corner brackets */}
            <Animated.View style={[styles.cornerTL, { opacity: cornerPulse }]}>
              <View style={styles.cornerHorizontal} />
              <View style={styles.cornerVertical} />
            </Animated.View>
            <Animated.View style={[styles.cornerTR, { opacity: cornerPulse }]}>
              <View style={[styles.cornerHorizontal, { alignSelf: 'flex-end' }]} />
              <View style={[styles.cornerVertical, { alignSelf: 'flex-end' }]} />
            </Animated.View>
            <Animated.View style={[styles.cornerBL, { opacity: cornerPulse }]}>
              <View style={styles.cornerHorizontal} />
              <View style={[styles.cornerVertical, { marginTop: 'auto' }]} />
            </Animated.View>
            <Animated.View style={[styles.cornerBR, { opacity: cornerPulse }]}>
              <View style={[styles.cornerHorizontal, { alignSelf: 'flex-end' }]} />
              <View style={[styles.cornerVertical, { alignSelf: 'flex-end', marginTop: 'auto' }]} />
            </Animated.View>

            {/* Scanning line */}
            <Animated.View
              style={[
                styles.scanLine,
                {
                  opacity: scanLinePulse,
                  transform: [{ translateY: scanLineTranslateY }],
                },
              ]}
            />
          </View>

          <View style={styles.overlayDarkSide} />
        </View>

        {/* Bottom dark region */}
        <View style={styles.overlayDarkBottom} />
      </View>

      {/* Back button */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => onNavigate('home')}
        activeOpacity={0.7}
      >
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>

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

      {/* Scan instruction */}
      <View style={styles.instructionContainer}>
        <Text style={styles.instructionText}>
          {isProcessing ? 'processing...' : 'align qr code within frame'}
        </Text>
      </View>

      {/* ── Full-screen result overlay ──────────────────────────── */}
      {showResultOverlay && scanResult && (
        <Animated.View
          style={[
            styles.resultFullscreen,
            {
              opacity: overlayOpacity,
              transform: [{ scale: overlayScale }],
            },
          ]}
        >
          <View
            style={[
              styles.resultBackdrop,
              {
                backgroundColor:
                  scanResult.type === 'success'
                    ? 'rgba(5, 46, 22, 0.97)'
                    : 'rgba(69, 10, 10, 0.97)',
              },
            ]}
          >
            {/* Ripple rings */}
            <Animated.View
              style={[
                styles.rippleRing,
                {
                  borderColor:
                    scanResult.type === 'success'
                      ? 'rgba(34, 197, 94, 0.3)'
                      : 'rgba(239, 68, 68, 0.3)',
                  transform: [{ scale: ringScale }],
                  opacity: ringOpacity,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.rippleRing,
                {
                  borderColor:
                    scanResult.type === 'success'
                      ? 'rgba(34, 197, 94, 0.15)'
                      : 'rgba(239, 68, 68, 0.15)',
                  transform: [{ scale: ring2Scale }],
                  opacity: ring2Opacity,
                },
              ]}
            />

            {/* Icon */}
            <Animated.View
              style={[
                styles.resultIconContainer,
                {
                  backgroundColor:
                    scanResult.type === 'success'
                      ? '#22C55E'
                      : '#EF4444',
                  transform: [
                    { scale: iconScale },
                    { translateX: scanResult.type === 'error' ? shakeAnim : 0 },
                  ],
                },
              ]}
            >
              <Text style={styles.resultIconText}>
                {scanResult.type === 'success' ? '✓' : '✕'}
              </Text>
            </Animated.View>

            {/* Message */}
            <Animated.View
              style={{
                opacity: messageOpacity,
                transform: [{ translateY: messageTranslateY }],
              }}
            >
              <Text style={styles.resultTitle}>
                {scanResult.type === 'success' ? 'success' : 'failed'}
              </Text>
              <Text style={styles.resultMessage}>{scanResult.message}</Text>
            </Animated.View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────

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
    fontFamily: 'DotGothic16',
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
    marginTop: 'auto',
    letterSpacing: 1,
  },
  permissionText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 'auto',
    marginTop: 8,
    paddingHorizontal: 32,
    letterSpacing: 0.5,
  },
  // Overlay with viewfinder cutout
  overlayContainer: {
    ...StyleSheet.absoluteFill,
  },
  overlayDarkTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  overlayMiddleRow: {
    flexDirection: 'row',
    height: VIEWFINDER_SIZE,
  },
  overlayDarkSide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  overlayDarkBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  // Viewfinder
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
  },
  // Corner brackets
  cornerTL: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 28,
    height: 28,
  },
  cornerTR: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 28,
    height: 28,
  },
  cornerBL: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 28,
    height: 28,
  },
  cornerBR: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
  },
  cornerHorizontal: {
    width: 28,
    height: 3,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  cornerVertical: {
    width: 3,
    height: 28,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  // Scan line
  scanLine: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 5,
  },
  // Back button
  backButton: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  backButtonText: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  // Top branding
  topBranding: {
    position: 'absolute',
    top: 56,
    right: 16,
  },
  topBrandingText: {
    fontFamily: 'DotGothic16',
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
    backgroundColor: 'rgba(9, 9, 11, 0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E1E22',
  },
  bottomBarName: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#FFFFFF',
    flex: 1,
    marginRight: 12,
    letterSpacing: 0.5,
  },
  bottomBarUid: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#71717A',
    letterSpacing: 0.5,
  },
  // Instruction text
  instructionContainer: {
    position: 'absolute',
    bottom: 68,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  instructionText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1,
  },
  // Full-screen result overlay
  resultFullscreen: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
  },
  resultBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Ripple rings
  rippleRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
  },
  // Icon circle
  resultIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  resultIconText: {
    fontSize: 36,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  resultTitle: {
    fontFamily: 'DotGothic16',
    fontSize: 24,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 8,
  },
  resultMessage: {
    fontFamily: 'DotGothic16',
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    letterSpacing: 0.5,
    lineHeight: 22,
    paddingHorizontal: 40,
  },
});
