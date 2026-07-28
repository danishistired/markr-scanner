import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { AppScreen } from '../types';
import { Sanitize, isValidSubmitRequestResult } from '../lib/security';

interface AlreadyRegisteredScreenProps {
  fingerprint: string;
  onNavigate: (screen: AppScreen) => void;
}

/**
 * Shown when a device that is already registered attempts to register again.
 *
 * Allows the user to submit a re-registration request (ticket) that an admin
 * must physically verify and approve before the device can re-register.
 *
 * Security:
 *   - OWASP A03: reason text is sanitised (strip control chars, max 500 chars)
 *   - OWASP A04: RPC response type-guarded before use
 *   - OWASP A07: duplicate pending request rejected server-side
 */
export function AlreadyRegisteredScreen({
  fingerprint,
  onNavigate,
}: AlreadyRegisteredScreenProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function sanitizeReason(raw: string): string {
    // Strip control chars, trim, cap at 500 chars
    // eslint-disable-next-line no-control-regex
    return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, 500);
  }

  async function handleSubmit() {
    const cleanReason = sanitizeReason(reason).trim();

    if (cleanReason.length < 10) {
      setError('please describe your reason (at least 10 characters)');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'submit_reregistration_request',
        {
          p_fingerprint: fingerprint,
          p_reason: cleanReason,
        }
      );

      if (rpcError) {
        setError('failed to submit request. check your connection.');
        return;
      }

      // OWASP A04: runtime type guard
      if (!isValidSubmitRequestResult(data)) {
        setError('unexpected server response.');
        return;
      }

      if (!data.success) {
        if (data.error === 'request_already_pending') {
          // Already submitted — just navigate to pending screen
          onNavigate('request_pending');
          return;
        }
        if (data.error === 'device_blocked') {
          onNavigate('blocked');
          return;
        }
        if (data.error === 'reason_too_short') {
          setError('reason is too short. please provide more detail.');
          return;
        }
        setError(data.error ?? 'failed to submit. try again.');
        return;
      }

      // Success — navigate to pending screen
      Alert.alert(
        'request submitted',
        'your re-registration request has been sent to the admin. you will be notified once it is reviewed.',
        [{ text: 'ok', onPress: () => onNavigate('request_pending') }]
      );
    } catch {
      setError('connection error. check your network.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.wordmark}>markr</Text>
          <Text style={styles.subtitle}>device already registered</Text>
        </View>

        {/* Icon */}
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>⊠</Text>
        </View>

        {/* Message */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>one device · one account</Text>
          <Text style={styles.cardBody}>
            this device is already linked to a student account.{'\n\n'}
            if you need to change your account (e.g. new phone, wrong details),
            submit a request below. an admin will physically verify your identity
            and approve the change.
          </Text>
        </View>

        {/* Request form */}
        <View style={styles.form}>
          <Text style={styles.label}>reason for re-registration</Text>
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            placeholder="e.g. entered wrong UID, phone changed, reinstalled app..."
            placeholderTextColor="#3F3F46"
            value={reason}
            onChangeText={(v) => {
              setReason(v);
              if (error) setError('');
            }}
            multiline
            numberOfLines={4}
            maxLength={500}
            autoCorrect={false}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{reason.length}/500</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          activeOpacity={0.85}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#09090B" size="small" />
          ) : (
            <Text style={styles.buttonText}>submit request</Text>
          )}
        </TouchableOpacity>

        {/* Footer note */}
        <Text style={styles.footerNote}>
          requests are reviewed manually.{'\n'}
          average response time: 1–2 business days.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 40,
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
    color: '#EF4444',
    marginTop: 4,
    letterSpacing: 1,
  },

  iconWrap: { alignItems: 'center', marginBottom: 28 },
  icon: { fontSize: 64, color: '#EF4444' },

  card: {
    backgroundColor: '#141416',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A1F1F',
    padding: 20,
    marginBottom: 28,
  },
  cardTitle: {
    fontFamily: 'DotGothic16',
    fontSize: 14,
    color: '#EF4444',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  cardBody: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#71717A',
    lineHeight: 20,
    letterSpacing: 0.3,
  },

  form: { marginBottom: 20 },
  label: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#52525B',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontFamily: 'DotGothic16',
    fontSize: 13,
    minHeight: 100,
  },
  inputError: { borderColor: '#EF4444' },
  charCount: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#3F3F46',
    textAlign: 'right',
    marginTop: 4,
  },
  errorText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#EF4444',
    marginTop: 6,
    letterSpacing: 0.3,
  },

  button: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    fontFamily: 'DotGothic16',
    fontSize: 15,
    color: '#09090B',
    letterSpacing: 1,
  },

  footerNote: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#3F3F46',
    textAlign: 'center',
    lineHeight: 17,
    letterSpacing: 0.3,
  },
});
