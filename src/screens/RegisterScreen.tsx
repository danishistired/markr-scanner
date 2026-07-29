import React, { useState, ComponentProps } from 'react';
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
 * Registration form screen.
 * Submits directly to Supabase register_device RPC on form submit.
 * No OTP step — device fingerprint is the identity anchor.
 *
 * Security:
 *   - OWASP A03: Input sanitization on all fields
 *   - OWASP A04: Runtime type guard on Supabase response
 *   - OWASP A02: Fingerprint passed to saveRegistration for AES-GCM encryption
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

  function validate(): boolean {
    const newErrors: FormErrors = {};

    const name = Sanitize.name(form.name);
    const uid = Sanitize.uid(form.uid);
    const email = Sanitize.email(form.email);
    const phone = Sanitize.phone(form.phone);
    const section = Sanitize.section(form.section);

    if (!name || name.length < 2) newErrors.name = 'enter your full name';
    if (!uid || uid.length < 2) newErrors.uid = 'enter your roll number';
    if (!email || !email.includes('@')) newErrors.email = 'enter a valid email';
    if (!phone || phone.replace(/\D/g, '').length < 10) newErrors.phone = 'enter a valid phone number';
    if (!section || section.length < 1) newErrors.section = 'enter your section';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (submitting) return;

    setSubmitting(true);
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('register_device', {
        p_fingerprint: fingerprint,
        p_name: Sanitize.name(form.name),
        p_uid: Sanitize.uid(form.uid),
        p_email: Sanitize.email(form.email),
        p_phone: Sanitize.phone(form.phone),
        p_section: Sanitize.section(form.section),
      });

      if (rpcError) {
        Alert.alert('error', 'registration failed. check your connection.');
        return;
      }

      // OWASP A04: Runtime type guard on Supabase response
      if (!isValidRegisterResult(rpcData)) {
        Alert.alert('error', 'unexpected server response.');
        return;
      }

      if (!rpcData.success) {
        if (rpcData.error === 'device_blocked') {
          onNavigate('blocked');
          return;
        }
        if (rpcData.error === 'already_registered' || rpcData.already_registered) {
          onNavigate('already_registered');
          return;
        }
        Alert.alert('error', rpcData.message || 'registration failed.');
        return;
      }

      const registration: RegistrationData = {
        student_name: Sanitize.name(form.name),
        student_uid: Sanitize.uid(form.uid),
        student_email: Sanitize.email(form.email),
        student_phone: Sanitize.phone(form.phone),
        student_section: Sanitize.section(form.section),
        device_fingerprint: fingerprint,
      };

      // OWASP A02: Encrypt registration data at rest with AES-GCM
      await saveRegistration(registration, fingerprint);
      onNavigate('home', registration);
    } catch {
      Alert.alert('error', 'connection failed. check your network.');
    } finally {
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
            {isWebPWA ? 'pwa · secure device registration' : 'device registration'}
          </Text>
          {insecureContext && (
            <View style={styles.warnBadge}>
              <Text style={styles.warnBadgeText}>⚠ HTTP: security degraded</Text>
            </View>
          )}
        </View>

        {/* Form */}
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
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#09090B" />
            ) : (
              <Text style={styles.buttonText}>register device →</Text>
            )}
          </TouchableOpacity>
        </View>

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
  keyboardType?: ComponentProps<typeof TextInput>['keyboardType'];
  autoCapitalize?: ComponentProps<typeof TextInput>['autoCapitalize'];
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
