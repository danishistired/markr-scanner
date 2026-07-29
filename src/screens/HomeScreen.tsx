import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { RegistrationData, AppScreen } from '../types';

interface HomeScreenProps {
  registration: RegistrationData;
  onNavigate: (screen: AppScreen) => void;
}

/**
 * Home screen — post-login landing page.
 * Shows student account info and a CTA to open the scanner.
 * Minimalist dark design with DotGothic16 pixel font and PWA identity badge.
 */
export function HomeScreen({ registration, onNavigate }: HomeScreenProps) {
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerTranslateY = useRef(new Animated.Value(20)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(30)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const buttonTranslateY = useRef(new Animated.Value(20)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const stagger = (delay: number, opacity: Animated.Value, translateY: Animated.Value, duration = 500) =>
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration,
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration,
          delay,
          useNativeDriver: true,
        }),
      ]);

    Animated.stagger(0, [
      stagger(100, headerOpacity, headerTranslateY),
      stagger(250, cardOpacity, cardTranslateY, 600),
      stagger(450, buttonOpacity, buttonTranslateY),
      Animated.timing(footerOpacity, {
        toValue: 1,
        duration: 400,
        delay: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [headerOpacity, headerTranslateY, cardOpacity, cardTranslateY, buttonOpacity, buttonTranslateY, footerOpacity]);

  const initials = registration.student_name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const isWebPWA = Platform.OS === 'web' || registration.device_fingerprint.startsWith('pwa_');

  return (
    <View style={styles.container}>
      {/* Header */}
      <Animated.View
        style={[
          styles.header,
          {
            opacity: headerOpacity,
            transform: [{ translateY: headerTranslateY }],
          },
        ]}
      >
        <Text style={styles.wordmark}>markr</Text>
        <Text style={styles.tagline}>attendance scanner</Text>
      </Animated.View>

      {/* Account card */}
      <Animated.View
        style={[
          styles.card,
          {
            opacity: cardOpacity,
            transform: [{ translateY: cardTranslateY }],
          },
        ]}
      >
        {/* Avatar */}
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.avatarInfo}>
            <Text style={styles.studentName} numberOfLines={1}>
              {registration.student_name}
            </Text>
            <Text style={styles.studentUid}>{registration.student_uid}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Info grid */}
        <View style={styles.infoGrid}>
          <InfoRow label="email" value={registration.student_email} />
          <InfoRow label="phone" value={registration.student_phone} />
          <InfoRow label="section" value={registration.student_section} />
          {registration.is_otp_verified && (
            <InfoRow label="identity" value="✓ OTP Verified" />
          )}
        </View>

        {isWebPWA && (
          <View style={styles.securityBadge}>
            <Text style={styles.securityBadgeText}>🔐 Web Crypto Device Signature Bound</Text>
          </View>
        )}
      </Animated.View>

      {/* Scan button */}
      <Animated.View
        style={{
          opacity: buttonOpacity,
          transform: [{ translateY: buttonTranslateY }],
        }}
      >
        <TouchableOpacity
          style={styles.scanButton}
          activeOpacity={0.85}
          onPress={() => onNavigate('scanner')}
        >
          <Text style={styles.scanButtonIcon}>⊞</Text>
          <Text style={styles.scanButtonText}>scan qr code</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.reRegisterButton}
          activeOpacity={0.8}
          onPress={() => onNavigate('already_registered')}
        >
          <Text style={styles.reRegisterButtonText}>request re-registration / account change →</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Footer */}
      <Animated.View style={[styles.footer, { opacity: footerOpacity }]}>
        <Text style={styles.footerText}>
          device registered · {registration.device_fingerprint.slice(0, 12)}
        </Text>
        <TouchableOpacity
          onPress={() => onNavigate('admin')}
          style={{ marginTop: 8 }}
        >
          <Text style={[styles.footerText, { color: '#52525B', textDecorationLine: 'underline' }]}>
            admin portal →
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingHorizontal: 20,
    paddingTop: 72,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 48,
  },
  wordmark: {
    fontFamily: 'DotGothic16',
    fontSize: 36,
    color: '#FFFFFF',
    letterSpacing: 3,
  },
  tagline: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#52525B',
    marginTop: 4,
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#141416',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E1E22',
    padding: 24,
    marginBottom: 32,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1E1E22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2E',
  },
  avatarText: {
    fontFamily: 'DotGothic16',
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  avatarInfo: {
    flex: 1,
  },
  studentName: {
    fontFamily: 'DotGothic16',
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  studentUid: {
    fontFamily: 'DotGothic16',
    fontSize: 13,
    color: '#52525B',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: '#1E1E22',
    marginVertical: 20,
  },
  infoGrid: {
    gap: 14,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#52525B',
    letterSpacing: 0.5,
    textTransform: 'lowercase',
  },
  infoValue: {
    fontFamily: 'DotGothic16',
    fontSize: 13,
    color: '#A1A1AA',
    letterSpacing: 0.3,
    flex: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  securityBadge: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E1E22',
    alignItems: 'center',
  },
  securityBadgeText: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#10B981',
    letterSpacing: 0.5,
  },
  scanButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  scanButtonIcon: {
    fontSize: 20,
    color: '#09090B',
  },
  scanButtonText: {
    fontFamily: 'DotGothic16',
    fontSize: 16,
    color: '#09090B',
    letterSpacing: 1,
  },
  reRegisterButton: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272A',
    backgroundColor: '#141416',
  },
  reRegisterButtonText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#A1A1AA',
    letterSpacing: 0.5,
  },
  footer: {
    marginTop: 'auto',
    alignItems: 'center',
  },
  footerText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#3F3F46',
    letterSpacing: 0.5,
  },
});
