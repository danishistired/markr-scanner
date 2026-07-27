import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface LoadingScreenProps {
  insecureContext?: boolean;
}

/**
 * Loading / Splash screen.
 * Shows the "markr" wordmark with a subtle pulse animation
 * while the app computes the fingerprint and checks registration.
 * OWASP A02: Surfaces HTTP insecure context warning to user.
 */
export function LoadingScreen({ insecureContext = false }: LoadingScreenProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <View style={styles.container}>
      <Animated.Text style={[styles.wordmark, { opacity }]}>
        markr
      </Animated.Text>
      <Text style={styles.subtitle}>initializing secure context...</Text>
      {insecureContext && (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>⚠ insecure connection</Text>
          <Text style={styles.warningText}>
            this app requires HTTPS for full security.{'\n'}
            cryptographic device binding is degraded on HTTP.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  wordmark: {
    fontFamily: 'DotGothic16',
    fontSize: 32,
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  subtitle: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#71717A',
    marginTop: 12,
    letterSpacing: 1,
  },
  warningBox: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: '#78350F',
    backgroundColor: '#1C1008',
    borderRadius: 6,
    padding: 14,
    alignItems: 'center',
  },
  warningTitle: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#F59E0B',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  warningText: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#78350F',
    textAlign: 'center',
    lineHeight: 16,
    letterSpacing: 0.3,
  },
});
