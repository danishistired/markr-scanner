import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { AppScreen, AdminRequestItem } from '../types';

interface AdminScreenProps {
  onNavigate: (screen: AppScreen) => void;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

/**
 * Admin Panel Screen — /admin
 *
 * Visually consistent with Markr dark aesthetic (DotGothic16 pixel typography,
 * dark #09090B palette, crisp cards & badges).
 *
 * Pulls re-registration requests and linked device_registrations from Supabase.
 * - Accept: Deletes user record from device_registrations & marks request as approved
 * - Reject: Sets request status to rejected with optional admin notes
 */
export function AdminScreen({ onNavigate }: AdminScreenProps) {
  const [requests, setRequests] = useState<AdminRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [activeFilter, setActiveFilter] = useState<FilterStatus>('pending');
  const [searchQuery, setSearchQuery] = useState('');

  // Reject Modal State
  const [rejectModalItem, setRejectModalItem] = useState<AdminRequestItem | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Accept Modal State
  const [acceptModalItem, setAcceptModalItem] = useState<AdminRequestItem | null>(null);

  const fetchRequests = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError('');

    try {
      // 1. Attempt to call admin_get_all_requests RPC
      const { data: rpcData, error: rpcError } = await supabase.rpc('admin_get_all_requests');

      if (!rpcError && rpcData) {
        const parsed = Array.isArray(rpcData) ? rpcData : [];
        setRequests(parsed);
        return;
      }

      // 2. Fallback: Direct table queries (joined manually)
      const { data: reqData, error: reqError } = await supabase
        .from('registration_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (reqError) {
        setError(reqError.message || 'Failed to load requests from database.');
        return;
      }

      const { data: devData } = await supabase
        .from('device_registrations')
        .select('*');

      const devMap = new Map<string, any>();
      if (devData) {
        devData.forEach((d) => devMap.set(d.device_fingerprint, d));
      }

      const combined: AdminRequestItem[] = (reqData || []).map((r: any) => {
        const dev = devMap.get(r.device_fingerprint);
        return {
          id: r.id,
          device_fingerprint: r.device_fingerprint,
          reason: r.reason,
          status: r.status,
          admin_notes: r.admin_notes,
          created_at: r.created_at,
          updated_at: r.updated_at,
          student_name: dev?.student_name,
          student_uid: dev?.student_uid,
          student_email: dev?.student_email,
          student_phone: dev?.student_phone,
          student_section: dev?.student_section,
        };
      });

      setRequests(combined);
    } catch (e: any) {
      setError(e?.message || 'Connection error. Could not load database records.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Handle Accept / Approve
  async function handleAcceptConfirm() {
    if (!acceptModalItem) return;
    setActionLoading(true);

    try {
      // Try RPC first
      const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_approve_request', {
        p_request_id: acceptModalItem.id,
      });

      if (rpcErr || (rpcData && !rpcData.success)) {
        // Direct query fallback:
        // 1. Delete from device_registrations
        await supabase
          .from('device_registrations')
          .delete()
          .eq('device_fingerprint', acceptModalItem.device_fingerprint);

        // 2. Update status in registration_requests
        const { error: updateErr } = await supabase
          .from('registration_requests')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('id', acceptModalItem.id);

        if (updateErr) throw updateErr;
      }

      showAlert(
        'Request Approved',
        `Device registration deleted for fingerprint ${acceptModalItem.device_fingerprint.slice(0, 10)}... The user can now re-register!`
      );

      setAcceptModalItem(null);
      fetchRequests(true);
    } catch (err: any) {
      showAlert('Error', err?.message || 'Failed to accept request.');
    } finally {
      setActionLoading(false);
    }
  }

  // Handle Reject
  async function handleRejectConfirm() {
    if (!rejectModalItem) return;
    setActionLoading(true);

    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_reject_request', {
        p_request_id: rejectModalItem.id,
        p_notes: rejectNotes.trim() || null,
      });

      if (rpcErr || (rpcData && !rpcData.success)) {
        // Direct fallback:
        const { error: updateErr } = await supabase
          .from('registration_requests')
          .update({
            status: 'rejected',
            admin_notes: rejectNotes.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', rejectModalItem.id);

        if (updateErr) throw updateErr;
      }

      showAlert('Request Rejected', 'The re-registration request has been marked as rejected.');

      setRejectModalItem(null);
      setRejectNotes('');
      fetchRequests(true);
    } catch (err: any) {
      showAlert('Error', err?.message || 'Failed to reject request.');
    } finally {
      setActionLoading(false);
    }
  }

  function showAlert(title: string, msg: string) {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  }

  function formatDate(isoStr: string) {
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  }

  // Filter & Search Logic
  const filteredRequests = requests.filter((item) => {
    if (activeFilter !== 'all' && item.status !== activeFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const name = (item.student_name || '').toLowerCase();
      const uid = (item.student_uid || '').toLowerCase();
      const reason = (item.reason || '').toLowerCase();
      const fp = (item.device_fingerprint || '').toLowerCase();
      const email = (item.student_email || '').toLowerCase();

      return (
        name.includes(q) ||
        uid.includes(q) ||
        reason.includes(q) ||
        fp.includes(q) ||
        email.includes(q)
      );
    }

    return true;
  });

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const approvedCount = requests.filter((r) => r.status === 'approved' || r.status === 'completed').length;
  const rejectedCount = requests.filter((r) => r.status === 'rejected').length;

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>markr</Text>
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>ADMIN PORTAL</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => fetchRequests(true)}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.refreshBtnText}>↻ refresh</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exitBtn}
            onPress={() => onNavigate('home')}
          >
            <Text style={styles.exitBtnText}>exit admin ✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Overview Cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{requests.length}</Text>
          <Text style={styles.statLabel}>total tickets</Text>
        </View>

        <View style={[styles.statCard, { borderColor: '#78350F' }]}>
          <Text style={[styles.statNumber, { color: '#F59E0B' }]}>{pendingCount}</Text>
          <Text style={styles.statLabel}>pending</Text>
        </View>

        <View style={[styles.statCard, { borderColor: '#064E3B' }]}>
          <Text style={[styles.statNumber, { color: '#10B981' }]}>{approvedCount}</Text>
          <Text style={styles.statLabel}>approved</Text>
        </View>

        <View style={[styles.statCard, { borderColor: '#7F1D1D' }]}>
          <Text style={[styles.statNumber, { color: '#EF4444' }]}>{rejectedCount}</Text>
          <Text style={styles.statLabel}>rejected</Text>
        </View>
      </View>

      {/* Search & Filters */}
      <View style={styles.filterSection}>
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, roll UID, fingerprint..."
            placeholderTextColor="#52525B"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearch}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.tabsRow}>
          <FilterTab
            label={`Pending (${pendingCount})`}
            active={activeFilter === 'pending'}
            onPress={() => setActiveFilter('pending')}
            color="#F59E0B"
          />
          <FilterTab
            label={`All (${requests.length})`}
            active={activeFilter === 'all'}
            onPress={() => setActiveFilter('all')}
          />
          <FilterTab
            label={`Approved (${approvedCount})`}
            active={activeFilter === 'approved'}
            onPress={() => setActiveFilter('approved')}
            color="#10B981"
          />
          <FilterTab
            label={`Rejected (${rejectedCount})`}
            active={activeFilter === 'rejected'}
            onPress={() => setActiveFilter('rejected')}
            color="#EF4444"
          />
        </View>
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.loadingText}>Fetching database requests...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchRequests()}>
            <Text style={styles.retryBtnText}>Retry Database Connection</Text>
          </TouchableOpacity>
        </View>
      ) : filteredRequests.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>📂</Text>
          <Text style={styles.emptyText}>No requests found for this filter.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {filteredRequests.map((item) => (
            <RequestCard
              key={item.id}
              item={item}
              formatDate={formatDate}
              onAccept={() => setAcceptModalItem(item)}
              onReject={() => {
                setRejectModalItem(item);
                setRejectNotes('');
              }}
            />
          ))}
        </ScrollView>
      )}

      {/* Accept Confirmation Modal */}
      <Modal
        visible={!!acceptModalItem}
        transparent
        animationType="fade"
        onRequestClose={() => setAcceptModalItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Approve Re-Registration?</Text>
            <Text style={styles.modalDescription}>
              Accepting this request will <Text style={styles.boldRed}>DELETE</Text> the student's existing registration from the <Text style={styles.codeText}>device_registrations</Text> database table.
            </Text>
            <Text style={styles.modalSubtext}>
              Target fingerprint: {acceptModalItem?.device_fingerprint.slice(0, 16)}...
            </Text>

            {acceptModalItem?.student_name && (
              <View style={styles.modalStudentCard}>
                <Text style={styles.modalStudentName}>{acceptModalItem.student_name}</Text>
                <Text style={styles.modalStudentUid}>UID: {acceptModalItem.student_uid}</Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setAcceptModalItem(null)}
                disabled={actionLoading}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.confirmApproveBtn}
                onPress={handleAcceptConfirm}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color="#09090B" size="small" />
                ) : (
                  <Text style={styles.confirmApproveBtnText}>✓ Confirm & Delete Registration</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reject Modal */}
      <Modal
        visible={!!rejectModalItem}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectModalItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: '#EF4444' }]}>Reject Re-Registration</Text>
            <Text style={styles.modalDescription}>
              Reject ticket for fingerprint {rejectModalItem?.device_fingerprint.slice(0, 14)}...
            </Text>

            <Text style={styles.inputLabel}>Admin Note (Reason for rejection)</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="e.g. Identity verification failed, invalid reason provided..."
              placeholderTextColor="#3F3F46"
              value={rejectNotes}
              onChangeText={setRejectNotes}
              multiline
              numberOfLines={3}
              maxLength={300}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setRejectModalItem(null)}
                disabled={actionLoading}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.confirmRejectBtn}
                onPress={handleRejectConfirm}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.confirmRejectBtnText}>✕ Reject Ticket</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Filter Tab Component ──────────────────────────────────────
function FilterTab({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  color?: string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.tabBtn,
        active && styles.tabBtnActive,
        active && color ? { borderColor: color } : null,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive, active && color ? { color } : null]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Request Card Component ────────────────────────────────────
function RequestCard({
  item,
  formatDate,
  onAccept,
  onReject,
}: {
  item: AdminRequestItem;
  formatDate: (d: string) => string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const isPending = item.status === 'pending';
  const isApproved = item.status === 'approved' || item.status === 'completed';
  const isRejected = item.status === 'rejected';

  return (
    <View
      style={[
        styles.card,
        isPending && styles.cardPending,
        isApproved && styles.cardApproved,
        isRejected && styles.cardRejected,
      ]}
    >
      {/* Card Header: Fingerprint & Status */}
      <View style={styles.cardHeader}>
        <View style={styles.fpBox}>
          <Text style={styles.fpLabel}>FINGERPRINT</Text>
          <Text style={styles.fpValue}>{item.device_fingerprint}</Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            isPending && styles.badgePending,
            isApproved && styles.badgeApproved,
            isRejected && styles.badgeRejected,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              isPending && { color: '#F59E0B' },
              isApproved && { color: '#10B981' },
              isRejected && { color: '#EF4444' },
            ]}
          >
            ● {item.status.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Linked Student Registration Info */}
      <View style={styles.studentInfoCard}>
        <Text style={styles.studentInfoTitle}>LINKED STUDENT REGISTRATION</Text>
        {item.student_name ? (
          <View style={styles.studentDetailsGrid}>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Name</Text>
              <Text style={styles.detailValue}>{item.student_name}</Text>
            </View>

            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Roll UID</Text>
              <Text style={styles.detailValue}>{item.student_uid}</Text>
            </View>

            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Section</Text>
              <Text style={styles.detailValue}>{item.student_section}</Text>
            </View>

            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Phone</Text>
              <Text style={styles.detailValue}>{item.student_phone}</Text>
            </View>

            <View style={[styles.detailCol, { width: '100%' }]}>
              <Text style={styles.detailLabel}>Email</Text>
              <Text style={styles.detailValue}>{item.student_email}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.noRegText}>⚠ Device not registered or already deleted.</Text>
        )}
      </View>

      {/* User's Request Reason */}
      <View style={styles.reasonWrap}>
        <Text style={styles.reasonLabel}>REASON FOR RE-REGISTRATION</Text>
        <Text style={styles.reasonText}>{item.reason}</Text>
      </View>

      {/* Admin Notes if rejected */}
      {item.admin_notes ? (
        <View style={styles.adminNotesWrap}>
          <Text style={styles.adminNotesLabel}>ADMIN REJECTION NOTE</Text>
          <Text style={styles.adminNotesText}>{item.admin_notes}</Text>
        </View>
      ) : null}

      {/* Footer info & Action Buttons */}
      <View style={styles.cardFooter}>
        <Text style={styles.timestampText}>Submitted: {formatDate(item.created_at)}</Text>

        {isPending && (
          <View style={styles.actionBtnsRow}>
            <TouchableOpacity style={styles.rejectBtn} onPress={onReject} activeOpacity={0.8}>
              <Text style={styles.rejectBtnText}>✕ REJECT</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.acceptBtn} onPress={onAccept} activeOpacity={0.8}>
              <Text style={styles.acceptBtnText}>✓ ACCEPT & DELETE USER</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 24,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    flexWrap: 'wrap',
    gap: 12,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  wordmark: {
    fontFamily: 'DotGothic16',
    fontSize: 28,
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  adminBadge: {
    backgroundColor: '#1E1B4B',
    borderColor: '#4338CA',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  adminBadgeText: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#818CF8',
    letterSpacing: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  refreshBtn: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  refreshBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#A1A1AA',
  },
  exitBtn: {
    backgroundColor: '#1C1010',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  exitBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#EF4444',
  },

  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#1E1E22',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: 'DotGothic16',
    fontSize: 22,
    color: '#FFFFFF',
  },
  statLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#71717A',
    marginTop: 2,
    textTransform: 'lowercase',
  },

  filterSection: {
    marginBottom: 16,
    gap: 12,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: 'DotGothic16',
    fontSize: 13,
    color: '#FFFFFF',
  },
  clearSearch: {
    fontSize: 14,
    color: '#71717A',
    padding: 4,
  },

  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  tabBtn: {
    backgroundColor: '#141416',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  tabBtnActive: {
    backgroundColor: '#1E1E22',
    borderColor: '#FFFFFF',
  },
  tabBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#71717A',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
  },

  listContent: {
    paddingBottom: 40,
    gap: 16,
  },

  card: {
    backgroundColor: '#141416',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E1E22',
    padding: 16,
    gap: 14,
  },
  cardPending: {
    borderColor: '#3B2A10',
  },
  cardApproved: {
    borderColor: '#064E3B',
  },
  cardRejected: {
    borderColor: '#3B1F1F',
  },

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  fpBox: {
    flex: 1,
  },
  fpLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 9,
    color: '#52525B',
    letterSpacing: 1,
  },
  fpValue: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 2,
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgePending: {
    backgroundColor: '#1C1508',
    borderColor: '#78350F',
  },
  badgeApproved: {
    backgroundColor: '#062016',
    borderColor: '#065F46',
  },
  badgeRejected: {
    backgroundColor: '#1C0D0D',
    borderColor: '#7F1D1D',
  },
  statusText: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    letterSpacing: 0.5,
  },

  studentInfoCard: {
    backgroundColor: '#09090B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 12,
  },
  studentInfoTitle: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#71717A',
    letterSpacing: 1,
    marginBottom: 8,
  },
  studentDetailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailCol: {
    minWidth: 110,
  },
  detailLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 9,
    color: '#52525B',
  },
  detailValue: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 1,
  },
  noRegText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#71717A',
  },

  reasonWrap: {
    backgroundColor: '#18181B',
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  reasonLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 9,
    color: '#71717A',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reasonText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#E4E4E7',
    lineHeight: 18,
  },

  adminNotesWrap: {
    backgroundColor: '#1C1010',
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#3B1F1F',
  },
  adminNotesLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 9,
    color: '#EF4444',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  adminNotesText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#A1A1AA',
  },

  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E1E22',
  },
  timestampText: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#52525B',
  },

  actionBtnsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  rejectBtn: {
    backgroundColor: '#1C1010',
    borderColor: '#7F1D1D',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rejectBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#EF4444',
  },
  acceptBtn: {
    backgroundColor: '#10B981',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  acceptBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#09090B',
    fontWeight: '600',
  },

  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 60,
  },
  loadingText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#71717A',
  },
  errorIcon: { fontSize: 32, color: '#EF4444' },
  errorText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#EF4444',
    textAlign: 'center',
  },
  retryBtn: {
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 8,
  },
  retryBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#FFFFFF',
  },
  emptyIcon: { fontSize: 36, color: '#52525B' },
  emptyText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#52525B',
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#141416',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 20,
    gap: 14,
  },
  modalTitle: {
    fontFamily: 'DotGothic16',
    fontSize: 18,
    color: '#10B981',
    letterSpacing: 1,
  },
  modalDescription: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#A1A1AA',
    lineHeight: 18,
  },
  boldRed: { color: '#EF4444', fontWeight: 'bold' },
  codeText: { color: '#818CF8' },
  modalSubtext: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#52525B',
  },
  modalStudentCard: {
    backgroundColor: '#09090B',
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  modalStudentName: {
    fontFamily: 'DotGothic16',
    fontSize: 14,
    color: '#FFFFFF',
  },
  modalStudentUid: {
    fontFamily: 'DotGothic16',
    fontSize: 11,
    color: '#71717A',
  },
  inputLabel: {
    fontFamily: 'DotGothic16',
    fontSize: 10,
    color: '#71717A',
  },
  notesInput: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 6,
    padding: 10,
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#FFFFFF',
    minHeight: 70,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  cancelBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#71717A',
  },
  confirmApproveBtn: {
    backgroundColor: '#10B981',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmApproveBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#09090B',
    fontWeight: '600',
  },
  confirmRejectBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmRejectBtnText: {
    fontFamily: 'DotGothic16',
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
