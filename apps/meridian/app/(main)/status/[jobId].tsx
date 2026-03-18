/**
 * Job Status screen — polls until complete, then navigates to receipt
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { completeJob, getIntentStatus } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import { speak } from '../../../lib/speech';

const POLL_MS = 3000;

type StatusPhase = 'executing' | 'done' | 'error';

export default function StatusScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { agentId, currentJob, setPhase } = useStore();
  const [statusPhase, setStatusPhase] = useState<StatusPhase>('executing');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Tick elapsed timer
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll the payment intent status until terminal state
  useEffect(() => {
    if (statusPhase !== 'executing' || !jobId) return;
    const t = setInterval(async () => {
      try {
        const data = await getIntentStatus(jobId);
        const s = data.status;
        if (s === 'completed' || s === 'confirmed' || s === 'verified') {
          clearInterval(t);
          setStatusPhase('done');
          setPhase('done');
          speak('Job complete! Your receipt is ready.');
        } else if (s === 'failed' || s === 'expired' || s === 'rejected') {
          clearInterval(t);
          setStatusPhase('error');
          setError(`Job ${s}.`);
          setPhase('error');
        }
      } catch {
        // transient network error — keep polling
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [statusPhase, jobId]);

  const handleComplete = useCallback(async () => {
    if (!jobId || !agentId) return;
    try {
      await completeJob(jobId, agentId);
      setStatusPhase('done');
      speak('Job marked complete.');
    } catch (e: any) {
      setError(e.message);
    }
  }, [jobId, agentId]);

  const isDone = statusPhase === 'done';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Back */}
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={20} color="#6b7280" />
        </Pressable>

        {/* Status icon */}
        <View style={styles.iconWrap}>
          {isDone ? (
            <View style={[styles.icon, styles.iconDone]}>
              <Ionicons name="checkmark-circle" size={52} color="#22c55e" />
            </View>
          ) : (
            <View style={[styles.icon, styles.iconRunning]}>
              <ActivityIndicator size="large" color="#6366f1" />
            </View>
          )}
        </View>

        {/* Status text */}
        <Text style={styles.statusTitle}>
          {isDone ? 'Job Complete' : 'Agent Working…'}
        </Text>
        <Text style={styles.statusSub}>
          {isDone
            ? 'Your task has been completed.'
            : `${currentJob ? currentJob.agentId : 'Agent'} is on it · ${elapsed}s`}
        </Text>

        {/* Job details */}
        {currentJob && (
          <View style={styles.card}>
            <Detail label="Job ID" value={jobId ?? ''} mono />
            <Detail label="Agent" value={currentJob.agentId} />
            <Detail label="Amount" value={`$${currentJob.agreedPriceUsdc} USDC`} />
            <Detail label="Status" value={isDone ? 'Completed ✓' : 'Executing…'} />
          </View>
        )}

        {error && (
          <Text style={styles.error}>{error}</Text>
        )}

        {/* Actions */}
        {isDone ? (
          <Pressable
            onPress={() => router.push(`/receipt/${jobId}`)}
            style={styles.primaryBtn}
          >
            <Ionicons name="receipt-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>View Receipt</Text>
          </Pressable>
        ) : (
          <Pressable onPress={handleComplete} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>Mark Complete Manually</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={detailStyles.row}>
      <Text style={detailStyles.label}>{label}</Text>
      <Text style={[detailStyles.value, mono && detailStyles.mono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 13, color: '#6b7280' },
  value: { fontSize: 13, color: '#d1d5db', maxWidth: '60%', textAlign: 'right' },
  mono:  { fontFamily: 'monospace', fontSize: 11 },
});

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#080808' },
  container: { flex: 1, padding: 24, alignItems: 'center' },
  back:      { alignSelf: 'flex-start', marginBottom: 32 },
  iconWrap:  { marginBottom: 20 },
  icon:      { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  iconRunning: { backgroundColor: '#1e1b4b' },
  iconDone:    { backgroundColor: '#052e16' },
  statusTitle: { fontSize: 24, fontWeight: '700', color: '#f9fafb', marginBottom: 8 },
  statusSub:   { fontSize: 14, color: '#6b7280', marginBottom: 28, textAlign: 'center' },
  card: {
    width: '100%',
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    marginBottom: 24,
  },
  error: { color: '#ef4444', fontSize: 14, marginBottom: 16 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#4338ca',
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
    width: '100%',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  secondaryBtn: {
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 14, color: '#6b7280' },
});
