import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { AppScreen, ReregistrationRequestStatus } from '../types';
import { isValidReregistrationStatus } from '../lib/security';

interface RequestPendingScreenProps {
  fingerprint: string;
  onNavigate: (screen: AppScreen) => void;
}

const POLL_INTERVAL_MS = 30_000; // poll every 30 seconds

/**
 * Shown after a user submits a re-registration request.
 * Polls get_reregistration_status every 30 s.
 *
 * State transitions:
 *   pending  → stays here, shows spinner + submitted date
 *   approved → navigates to 'register' (admin unlocked the device)
 *   rejected → shows rejection reason, option to resubmit
 */
export function RequestPendingScreen({
  fingerprint,
  onNavigate,
}: RequestPendingScreenProps) {
  const [requestStatus, setRequestStatus] =
    useState<ReregistrationRequestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const pulseAnim = useRef(new Animated.Value(0.6)).current;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pulse animation for pending state
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const fetchStatus = useCallback(async () => {
    try {
      const { data, error: rpcError } = await supabase.rpc(
        'get_reregistration_status',
        { p_fingerprint: fingerprint }
      );

      if (rpcError) {
        setError('could not check status. check your connection.');
        return;
      }

      // OWASP A04: runtime type guard
      if (!isValidReregistrationStatus(data)) {
        setError('unexpected server response.');
        return;
      }

      setError('');

      if (!data.has_request) {
        // No request found — go back to register
        onNavigate('register');
        return;
      }

      setRequestStatus({
        status: data.status!,
        admin_notes: data.admin_notes,
        created_at: data.created_at!,
      });

      // If approved → navigate to register immediately
      if (data.status === 'approved') {
        onNavigate('register');
      }
    } catch {
      setError('connection error. will retry in 30s.');
    } finally {
      setLoading(false);
    }
  }, [fingerprint, onNavigate]);

  // Fetch on mount + poll every 30 s
  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  const isPending = requestStatus?.status === 'pending';
  const isRejected = requestStatus?.status === 'rejected';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>markr</Text>
        <Text style={styles.subtitle}>
          {isPending ? 'request under review' : isRejected ? 'request rejected' : 'checking...'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator color="#FFFFFF" size="large" />
          <Text style={styles.loadingText}>checking request status...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerContent}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchStatus}>
            <Text style={styles.retryButtonText}>retry</Text>
          </TouchableOpacity>
        </View>
      ) : isPending ? (
        /* ── Pending state ── */
        <View style={styles.content}>
          <Animated.Text style={[styles.statusIcon, { opacity: pulseAnim }]}>
            ◌
          </Animated.Text>
          <Text style={styles.statusTitle}>waiting for admin review</Text>
          <Text style={styles.statusBody}>
            your request has been submitted and is awaiting manual verification.
            the admin will review your identity and approve or reject the request.
          </Text>

          {requestStatus?.created_at && (
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>submitted</Text>
              <Text style={styles.infoValue}>
                {formatDate(requestStatus.created_at)}
              </Text>
            </View>
          )}

          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>auto-refresh</Text>
            <Text style={styles.infoValue}>every 30 seconds</Text>
          </View>

          <Text style={styles.footerNote}>
            this screen refreshes automatically.{'\n'}
            you can close and reopen the app — your request is saved.
          </Text>
        </View>
      ) : isRejected ? (
        /* ── Rejected state ── */
        <View style={styles.content}>
          <Text style={styles.statusIconRejected}>✕</Text>
          <Text style={styles.statusTitleRejected}>request rejected</Text>

          {requestStatus?.admin_notes ? (
            <View style={styles.adminNoteCard}>
              <Text style={styles.adminNoteLabel}>admin note</Text>
              <Text style={styles.adminNoteText}>{requestStatus.admin_notes}</Text>
            </View>
          ) : (
            <Text style={styles.statusBody}>
              your request was not approved. contact your administrator directly
              for more information.
            </Text>
          )}

          <TouchableOpacity
            style={styles.resubmitButton}
            onPress={() => onNavigate('already_registered')}
            activeOpacity={0.85}
          >
            <Text style={styles.resubmitButtonText}>submit new request</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B', paddingHorizontal: 20 },

  header: { paddingTop: 64, marginBottom: 40 },
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

  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#52525B',
    letterSpacing: 0.5,
  },
  errorIcon: { fontSize: 36, color: '#EF4444' },
  errorText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#EF4444',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  retryButton: {
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginTop: 8,
  },
  retryButtonText: {
    fontFamily: 'DotGothic16',
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 1,
  },

  content: { flex: 1, alignItems: 'center', paddingTop: 20 },

  statusIcon: {
    fontSize: 72,
    color: '#F59E0B',
    marginBottom: 20,
  },
  statusTitle: {
    fontFamily: 'DotGothic16',
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
  statusBody: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0.3,
    marginBottom: 28,
    paddingHorizontal: 8,
  },

  statusIconRejected: { fontSize: 64, color: '#EF4444', marginBottom: 16 },
  statusTitleRejected: {
    fontFamily: 'DotGothic16',
    fontSize: 16,
    color: '#EF4444',
    letterSpacing: 1,
    marginBottom: 20,
  },

  infoCard: {
    width: '100%',
    backgroundColor: '#141416',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E1E22',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#52525B',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#A1A1AA',
    letterSpacing: 0.3,
  },

  adminNoteCard: {
    width: '100%',
    backgroundColor: '#1C1010',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B1F1F',
    padding: 16,
    marginBottom: 24,
  },
  adminNoteLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#EF4444',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  adminNoteText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#A1A1AA',
    lineHeight: 20,
    letterSpacing: 0.3,
  },

  resubmitButton: {
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  resubmitButtonText: {
    fontFamily: 'DotGothic16',
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 1,
  },

  footerNote: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#3F3F46',
    textAlign: 'center',
    lineHeight: 17,
    letterSpacing: 0.3,
    position: 'absolute',
    bottom: 40,
  },
});
