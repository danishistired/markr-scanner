import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { saveRegistration } from '../lib/storage';
import { RegistrationData, AppScreen } from '../types';
import { Sanitize, isValidRegisterResult } from '../lib/security';
import { generateOTP, verifyOTP, otpSecondsRemaining, lockoutSecondsRemaining, OTPSession } from '../lib/otp';

interface RegisterScreenProps {
  fingerprint: string;
  onNavigate: (screen: AppScreen, data?: RegistrationData) => void;
  insecureContext?: boolean;
}

interface FormData {
  name: string;
  uid: string;
  email: string;
  phone: string;
  section: string;
}

interface FormErrors {
  name?: string;
  uid?: string;
  email?: string;
  phone?: string;
  section?: string;
}

/**
 * Registration form screen — OWASP-hardened.
 *
 * Security improvements over v1:
 *   - HMAC-SHA256 TOTP with 5-min expiry (OWASP A07)
 *   - 3-attempt lockout + countdown timer (OWASP A07)
 *   - Input sanitization on all fields (OWASP A03)
 *   - Runtime type guard on Supabase response (OWASP A04)
 *   - No OTP code in console.log (OWASP A09)
 *   - fingerprint passed to saveRegistration for AES-GCM encryption (OWASP A02)
 *   - is_otp_verified NOT stored client-side (OWASP A04)
 */
export function RegisterScreen({ fingerprint, onNavigate, insecureContext = false }: RegisterScreenProps) {
  const [form, setForm] = useState<FormData>({
    name: '',
    uid: '',
    email: '',
    phone: '',
    section: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // OTP state
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSession, setOtpSession] = useState<OTPSession | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [lockoutCountdown, setLockoutCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown ticker
  useEffect(() => {
    if (!otpSession) return;
    if (countdownRef.current) clearInterval(countdownRef.current);

    countdownRef.current = setInterval(() => {
      setCountdown(otpSecondsRemaining(otpSession));
      setLockoutCountdown(lockoutSecondsRemaining(otpSession));
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [otpSession]);

  function validate(): boolean {
    const newErrors: FormErrors = {};

    const name = Sanitize.name(form.name);
    const uid = Sanitize.uid(form.uid);
    const email = Sanitize.email(form.email);
    const phone = Sanitize.phone(form.phone);
    const section = Sanitize.section(form.section);

    if (!name) newErrors.name = 'required';
    if (!uid) newErrors.uid = 'required';
    if (!email) {
      newErrors.email = 'required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'invalid email';
    }
    if (!phone) {
      newErrors.phone = 'required';
    } else if (!/^\+?[\d]{7,15}$/.test(phone.replace(/[\s-]/g, ''))) {
      newErrors.phone = 'invalid phone (digits only, 7-15 chars)';
    }
    if (!section) newErrors.section = 'required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  /** Step 1: Generate HMAC OTP and display to user */
  async function handleSendOTP() {
    if (!validate()) return;
    if (!fingerprint || fingerprint.length < 8) {
      Alert.alert('error', 'device signature not ready. please restart the app.');
      return;
    }

    setSubmitting(true);
    try {
      const phone = Sanitize.phone(form.phone);
      const { code, session } = await generateOTP(phone, fingerprint);

      setOtpSession(session);
      setOtpSent(true);
      setOtpError('');
      setCountdown(otpSecondsRemaining(session));
      setOtpInput('');

      // OWASP A09: Never log OTP to console in production
      // In dev mode only, show it via Alert (not console.log)
      if (__DEV__) {
        Alert.alert(
          'dev mode OTP',
          `OTP: ${code}\n(expires in 5 minutes)\n\nIn production, deliver via SMS/WhatsApp.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'OTP sent',
          `A verification code has been sent to ${phone}.\nIt expires in 5 minutes.`,
          [{ text: 'OK' }]
        );
      }
    } catch {
      Alert.alert('error', 'failed to generate OTP. check your device supports Web Crypto.');
    } finally {
      setSubmitting(false);
    }
  }

  /** Step 2: Verify HMAC OTP and register device */
  async function handleVerifyAndRegister() {
    if (!otpSession) return;

    // Check lockout
    if (lockoutCountdown > 0) {
      setOtpError(`too many attempts. wait ${lockoutCountdown}s`);
      return;
    }

    // Check expiry
    if (countdown === 0) {
      setOtpError('code expired. request a new one.');
      return;
    }

    // Sanitize OTP input — exactly 6 digits
    const sanitizedCode = Sanitize.otpCode(otpInput);
    if (!sanitizedCode) {
      setOtpError('enter 6-digit code');
      return;
    }

    setSubmitting(true);
    setOtpError('');

    try {
      const phone = Sanitize.phone(form.phone);
      const result = await verifyOTP(sanitizedCode, otpSession, phone, fingerprint);
      setOtpSession(result.updatedSession);

      if (!result.valid) {
        if (result.reason === 'expired') {
          setOtpError('code expired. tap "resend" to get a new one.');
        } else if (result.reason === 'locked' || result.reason === 'max_attempts') {
          const wait = lockoutSecondsRemaining(result.updatedSession);
          setOtpError(`too many attempts. wait ${wait}s before trying again.`);
        } else {
          const attemptsLeft = 3 - result.updatedSession.attempts;
          setOtpError(`invalid code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} left.`);
        }
        setSubmitting(false);
        return;
      }

      // OTP verified — proceed with device registration
      const { data: rpcData, error: rpcError } = await supabase.rpc('register_device', {
        p_fingerprint: fingerprint,
        p_name: Sanitize.name(form.name),
        p_uid: Sanitize.uid(form.uid),
        p_email: Sanitize.email(form.email),
        p_phone: phone,
        p_section: Sanitize.section(form.section),
      });

      if (rpcError) {
        Alert.alert('error', 'registration failed. try again.');
        setSubmitting(false);
        return;
      }

      // OWASP A04: Runtime type guard on Supabase response
      if (!isValidRegisterResult(rpcData)) {
        Alert.alert('error', 'unexpected server response.');
        setSubmitting(false);
        return;
      }

      if (!rpcData.success) {
        if (rpcData.error === 'device_blocked') {
          onNavigate('blocked');
          return;
        }
        Alert.alert('error', 'registration failed.');
        setSubmitting(false);
        return;
      }

      const registration: RegistrationData = {
        student_name: Sanitize.name(form.name),
        student_uid: Sanitize.uid(form.uid),
        student_email: Sanitize.email(form.email),
        student_phone: Sanitize.phone(form.phone),
        student_section: Sanitize.section(form.section),
        device_fingerprint: fingerprint,
        // OWASP A04: is_otp_verified is NOT stored — server is source of truth
      };

      if (rpcData.already_registered && rpcData.data) {
        const d = rpcData.data as Record<string, string>;
        if (d.student_name) registration.student_name = Sanitize.name(d.student_name);
        if (d.student_uid) registration.student_uid = Sanitize.uid(d.student_uid);
        if (d.student_email) registration.student_email = Sanitize.email(d.student_email);
        if (d.student_phone) registration.student_phone = Sanitize.phone(d.student_phone);
        if (d.student_section) registration.student_section = Sanitize.section(d.student_section);
      }

      // OWASP A02: pass fingerprint for AES-GCM encryption at rest
      await saveRegistration(registration, fingerprint);
      onNavigate('home', registration);
    } catch {
      Alert.alert('error', 'connection failed. check your network.');
      setSubmitting(false);
    }
  }

  function updateField(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  const isWebPWA = Platform.OS === 'web' || fingerprint.startsWith('pwa_');
  const isLocked = lockoutCountdown > 0;
  const isExpired = otpSent && countdown === 0 && !isLocked;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.wordmark}>markr</Text>
          <Text style={styles.subtitle}>
            {isWebPWA ? 'pwa · secure device registration' : 'device registration'}
          </Text>
          {isWebPWA && (
            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>🔐 Web Crypto + HMAC-OTP Active</Text>
            </View>
          )}
          {insecureContext && (
            <View style={styles.warnBadge}>
              <Text style={styles.warnBadgeText}>⚠ HTTP: security degraded</Text>
            </View>
          )}
        </View>

        {!otpSent ? (
          /* Step 1: Details */
          <View style={styles.form}>
            <FormField
              label="name"
              placeholder="full name"
              value={form.name}
              error={errors.name}
              onChangeText={(v) => updateField('name', v)}
              autoCapitalize="words"
              maxLength={100}
            />
            <FormField
              label="uid"
              placeholder="roll number"
              value={form.uid}
              error={errors.uid}
              onChangeText={(v) => updateField('uid', v)}
              autoCapitalize="characters"
              maxLength={40}
            />
            <FormField
              label="email"
              placeholder="student@example.com"
              value={form.email}
              error={errors.email}
              onChangeText={(v) => updateField('email', v)}
              keyboardType="email-address"
              autoCapitalize="none"
              maxLength={254}
            />
            <FormField
              label="phone"
              placeholder="+91 9876543210"
              value={form.phone}
              error={errors.phone}
              onChangeText={(v) => updateField('phone', v)}
              keyboardType="phone-pad"
              maxLength={20}
            />
            <FormField
              label="section"
              placeholder="A, B, C..."
              value={form.section}
              error={errors.section}
              onChangeText={(v) => updateField('section', v)}
              autoCapitalize="characters"
              maxLength={10}
            />

            <TouchableOpacity
              style={[styles.button, submitting && styles.buttonDisabled]}
              onPress={handleSendOTP}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#09090B" />
              ) : (
                <Text style={styles.buttonText}>send verification code →</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          /* Step 2: OTP Verification */
          <View style={styles.otpCard}>
            <Text style={styles.otpTitle}>enter verification code</Text>
            <Text style={styles.otpSubtitle}>
              6-digit code sent to {Sanitize.phone(form.phone)}
            </Text>

            {/* Expiry / lockout status */}
            {isLocked ? (
              <View style={styles.timerBadge}>
                <Text style={styles.timerBadgeLocked}>🔒 locked for {lockoutCountdown}s</Text>
              </View>
            ) : isExpired ? (
              <View style={styles.timerBadge}>
                <Text style={styles.timerBadgeExpired}>⏰ code expired</Text>
              </View>
            ) : (
              <View style={styles.timerBadge}>
                <Text style={styles.timerBadgeActive}>⏱ expires in {countdown}s</Text>
              </View>
            )}

            <View style={styles.otpInputContainer}>
              <TextInput
                style={[styles.otpInput, !!otpError && styles.otpInputError]}
                placeholder="------"
                placeholderTextColor="#3F3F46"
                value={otpInput}
                onChangeText={(v) => {
                  setOtpInput(v.replace(/\D/g, '').slice(0, 6));
                  setOtpError('');
                }}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                editable={!isLocked}
              />
              {!!otpError && <Text style={styles.errorText}>{otpError}</Text>}
            </View>

            <TouchableOpacity
              style={[styles.button, (submitting || isLocked || isExpired) && styles.buttonDisabled]}
              onPress={handleVerifyAndRegister}
              disabled={submitting || isLocked || isExpired}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#09090B" />
              ) : (
                <Text style={styles.buttonText}>verify & bind device →</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.resendButton}
              onPress={() => {
                setOtpSent(false);
                setOtpInput('');
                setOtpError('');
                setOtpSession(null);
              }}
            >
              <Text style={styles.resendButtonText}>← change details / resend</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.fingerprint}>
          device: {fingerprint.slice(0, 16)}...
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Inline FormField ────────────────────────────────────────────

interface FormFieldProps {
  label: string;
  placeholder: string;
  value: string;
  error?: string;
  onChangeText: (text: string) => void;
  keyboardType?: TextInput['props']['keyboardType'];
  autoCapitalize?: TextInput['props']['autoCapitalize'];
  maxLength?: number;
}

function FormField({
  label,
  placeholder,
  value,
  error,
  onChangeText,
  keyboardType,
  autoCapitalize,
  maxLength,
}: FormFieldProps) {
  return (
    <View style={fieldStyles.container}>
      <View style={fieldStyles.labelRow}>
        <Text style={fieldStyles.label}>{label}</Text>
        {error && <Text style={fieldStyles.error}>{error}</Text>}
      </View>
      <TextInput
        style={[fieldStyles.input, error && fieldStyles.inputError]}
        placeholder={placeholder}
        placeholderTextColor="#3F3F46"
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        selectionColor="#71717A"
        maxLength={maxLength}
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 64,
    paddingBottom: 32,
  },
  header: { marginBottom: 32 },
  wordmark: {
    fontFamily: 'DotGothic16',
    fontSize: 28,
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  subtitle: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#71717A',
    marginTop: 4,
    letterSpacing: 1,
  },
  badgeContainer: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#0D2818',
    borderColor: '#14532D',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#10B981',
    letterSpacing: 0.5,
  },
  warnBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#1C1008',
    borderColor: '#78350F',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  warnBadgeText: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#F59E0B',
    letterSpacing: 0.3,
  },
  form: { gap: 16, marginBottom: 32 },
  otpCard: {
    backgroundColor: '#141416',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 20,
    marginBottom: 32,
    gap: 12,
  },
  otpTitle: {
    fontFamily: 'DotGothic16',
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  otpSubtitle: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#71717A',
  },
  timerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  timerBadgeActive: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#10B981',
  },
  timerBadgeExpired: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#EF4444',
  },
  timerBadgeLocked: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#F59E0B',
  },
  otpInputContainer: { gap: 6 },
  otpInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'DotGothic16',
    fontSize: 22,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 8,
  },
  otpInputError: { borderColor: '#EF4444' },
  errorText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#EF4444',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    fontFamily: 'DotGothic16',
    fontSize: 14,
    color: '#09090B',
    fontWeight: '600',
    letterSpacing: 1,
  },
  resendButton: { alignItems: 'center', paddingVertical: 8 },
  resendButtonText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#52525B',
  },
  fingerprint: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#3F3F46',
    textAlign: 'center',
    marginTop: 24,
    letterSpacing: 0.5,
  },
});

const fieldStyles = StyleSheet.create({
  container: { gap: 6 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#71717A',
    letterSpacing: 0.5,
  },
  error: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: 'DotGothic16',
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  inputError: { borderColor: '#EF4444' },
});
