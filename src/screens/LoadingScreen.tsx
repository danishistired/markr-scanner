import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

/**
 * Loading / Splash screen.
 * Shows the "markr" wordmark with a subtle pulse animation
 * while the app computes the fingerprint and checks registration.
 */
export function LoadingScreen() {
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
      <Text style={styles.subtitle}>initializing...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: 'monospace',
    fontSize: 32,
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  subtitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#71717A',
    marginTop: 12,
    letterSpacing: 1,
  },
});
