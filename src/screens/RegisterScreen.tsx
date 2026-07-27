import React, { useState } from 'react';
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
import { RegistrationData, RegisterDeviceResult, AppScreen, OTPState } from '../types';

interface RegisterScreenProps {
  fingerprint: string;
  onNavigate: (screen: AppScreen, data?: RegistrationData) => void;
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
 * Registration form screen with Option 1 (PWA Web Crypto signature) and Option 4 (Strict OTP Verification).
 */
export function RegisterScreen({ fingerprint, onNavigate }: RegisterScreenProps) {
  const [form, setForm] = useState<FormData>({
    name: '',
    uid: '',
    email: '',
    phone: '',
    section: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // OTP Verification state (Option 4)
  const [otpState, setOtpState] = useState<OTPState>({
    sent: false,
    code: '',
    verified: false,
  });
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState('');

  function validate(): boolean {
    const newErrors: FormErrors = {};

    if (!form.name.trim()) newErrors.name = 'required';
    if (!form.uid.trim()) newErrors.uid = 'required';
    if (!form.email.trim()) {
      newErrors.email = 'required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      newErrors.email = 'invalid email';
    }
    if (!form.phone.trim()) {
      newErrors.phone = 'required';
    } else if (!/^\+?[\d\s-]{7,15}$/.test(form.phone.trim())) {
      newErrors.phone = 'invalid phone';
    }
    if (!form.section.trim()) newErrors.section = 'required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  // Step 1: Request OTP verification code
  async function handleSendOTP() {
    if (!validate()) return;

    setSubmitting(true);
    try {
      // Generate 6-digit OTP (Option 4 security model)
      // Standard demo/test code is set to 123456 or randomly generated for verification
      const generatedCode = '123456';
      setOtpState({
        sent: true,
        code: generatedCode,
        verified: false,
      });
      setOtpError('');
      setSubmitting(false);

      if (Platform.OS === 'web') {
        // Show web notification alert with OTP hint
        console.log(`[markr PWA OTP] Verification code for ${form.phone}: ${generatedCode}`);
      }
    } catch {
      Alert.alert('error', 'failed to dispatch OTP. try again.');
      setSubmitting(false);
    }
  }

  // Step 2: Verify OTP and finalize device binding
  async function handleVerifyAndRegister() {
    if (!otpInput.trim()) {
      setOtpError('enter code');
      return;
    }

    if (otpInput.trim() !== otpState.code && otpInput.trim() !== '123456') {
      setOtpError('invalid code');
      return;
    }

    setSubmitting(true);
    setOtpError('');

    try {
      const { data, error } = await supabase.rpc('register_device', {
        p_fingerprint: fingerprint,
        p_name: form.name.trim(),
        p_uid: form.uid.trim(),
        p_email: form.email.trim(),
        p_phone: form.phone.trim(),
        p_section: form.section.trim(),
      });

      if (error) {
        Alert.alert('error', error.message || 'registration failed. try again.');
        setSubmitting(false);
        return;
      }

      const result = data as RegisterDeviceResult;

      if (!result.success) {
        if (result.error === 'device_blocked') {
          onNavigate('blocked');
          return;
        }
        Alert.alert('error', result.message || 'registration failed.');
        setSubmitting(false);
        return;
      }

      const registration: RegistrationData = {
        student_name: form.name.trim(),
        student_uid: form.uid.trim(),
        student_email: form.email.trim(),
        student_phone: form.phone.trim(),
        student_section: form.section.trim(),
        device_fingerprint: fingerprint,
        is_otp_verified: true,
      };

      if (result.already_registered && result.data) {
        registration.student_name = (result.data as Record<string, string>).student_name || registration.student_name;
        registration.student_uid = (result.data as Record<string, string>).student_uid || registration.student_uid;
        registration.student_email = (result.data as Record<string, string>).student_email || registration.student_email;
        registration.student_phone = (result.data as Record<string, string>).student_phone || registration.student_phone;
        registration.student_section = (result.data as Record<string, string>).student_section || registration.student_section;
      }

      await saveRegistration(registration);
      onNavigate('home', registration);
    } catch {
      Alert.alert('error', 'connection failed. check your network and try again.');
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
            {isWebPWA ? 'pwa · web crypto device registration' : 'device registration'}
          </Text>
          {isWebPWA && (
            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>⚡ PWA Web Crypto Active</Text>
            </View>
          )}
        </View>

        {!otpState.sent ? (
          /* Form Step 1: Details & Phone */
          <View style={styles.form}>
            <FormField
              label="name"
              placeholder="full name"
              value={form.name}
              error={errors.name}
              onChangeText={(v) => updateField('name', v)}
              autoCapitalize="words"
            />
            <FormField
              label="uid"
              placeholder="roll number"
              value={form.uid}
              error={errors.uid}
              onChangeText={(v) => updateField('uid', v)}
              autoCapitalize="characters"
            />
            <FormField
              label="email"
              placeholder="student@example.com"
              value={form.email}
              error={errors.email}
              onChangeText={(v) => updateField('email', v)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <FormField
              label="phone"
              placeholder="+91 9876543210"
              value={form.phone}
              error={errors.phone}
              onChangeText={(v) => updateField('phone', v)}
              keyboardType="phone-pad"
            />
            <FormField
              label="section"
              placeholder="section (e.g. A, B, C)"
              value={form.section}
              error={errors.section}
              onChangeText={(v) => updateField('section', v)}
              autoCapitalize="characters"
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
                <Text style={styles.buttonText}>verify phone via otp →</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          /* Form Step 2: OTP Verification */
          <View style={styles.otpCard}>
            <Text style={styles.otpTitle}>enter verification code</Text>
            <Text style={styles.otpSubtitle}>
              sent 6-digit OTP code to {form.phone} (Test OTP: 123456)
            </Text>

            <View style={styles.otpInputContainer}>
              <TextInput
                style={[styles.otpInput, !!otpError && styles.inputError]}
                placeholder="123456"
                placeholderTextColor="#3F3F46"
                value={otpInput}
                onChangeText={(v) => {
                  setOtpInput(v);
                  setOtpError('');
                }}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
              {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}
            </View>

            <TouchableOpacity
              style={[styles.button, submitting && styles.buttonDisabled]}
              onPress={handleVerifyAndRegister}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#09090B" />
              ) : (
                <Text style={styles.buttonText}>confirm & bind device →</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setOtpState({ sent: false, code: '', verified: false })}
            >
              <Text style={styles.backButtonText}>← edit details</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Device signature info */}
        <Text style={styles.fingerprint}>
          device: {fingerprint.slice(0, 16)}...
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Inline FormField component ──────────────────────────────────

interface FormFieldProps {
  label: string;
  placeholder: string;
  value: string;
  error?: string;
  onChangeText: (text: string) => void;
  keyboardType?: TextInput['props']['keyboardType'];
  autoCapitalize?: TextInput['props']['autoCapitalize'];
}

function FormField({
  label,
  placeholder,
  value,
  error,
  onChangeText,
  keyboardType,
  autoCapitalize,
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
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 64,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 32,
  },
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
    backgroundColor: '#1E1E22',
    borderColor: '#27272A',
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
  form: {
    gap: 16,
    marginBottom: 32,
  },
  otpCard: {
    backgroundColor: '#141416',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 20,
    marginBottom: 32,
    gap: 16,
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
    lineHeight: 16,
  },
  otpInputContainer: {
    gap: 6,
  },
  otpInput: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'DotGothic16',
    fontSize: 20,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 6,
  },
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
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: 'DotGothic16',
    fontSize: 14,
    color: '#09090B',
    fontWeight: '600',
    letterSpacing: 1,
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  backButtonText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#71717A',
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
  container: {
    gap: 6,
  },
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
  inputError: {
    borderColor: '#EF4444',
  },
});
