import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * Blocked screen — dead end.
 * Shown when the device has been blocked by an administrator.
 * No buttons, no navigation, no escape.
 */
export function BlockedScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>device blocked</Text>
      <Text style={styles.message}>
        this device has been blocked by an administrator.{'\n'}
        contact your administrator to resolve this.
      </Text>
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
  title: {
    fontFamily: 'DotGothic16',
    fontSize: 18,
    color: '#71717A',
    letterSpacing: 1,
    marginBottom: 16,
  },
  message: {
    fontFamily: 'DotGothic16',
    fontSize: 13,
    color: '#3F3F46',
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0.5,
  },
});
