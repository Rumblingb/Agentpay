/**
 * Converse — the Bro concierge screen
 *
 * Flow:
 *   Hold to talk → Whisper STT → Phase 1 (plan, no hire)
 *   → Bro speaks price → fingerprint gate
 *   → Phase 2 (execute hire) → receipt
 *
 * Two biometric moments:
 *   1. Profile release — before sending profile to server (silent, in background)
 *   2. Payment confirm — after price announced, before hire fires
 *
 * Phases: idle → listening → thinking → confirming → done | error
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  SafeAreaView,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { C, PHASE_LABEL_COLOR } from '../../lib/theme';

import { OrbAnimation } from '../../components/OrbAnimation';
import { useStore } from '../../lib/store';
import { startRecording, stopRecording, transcribeAudio } from '../../lib/speech';
import { speak, stopSpeaking } from '../../lib/tts';
import { appendHistory } from '../../lib/storage';
import { planIntent, executeIntent, type ConciergePlanItem } from '../../lib/concierge';
import { loadProfileRaw, loadProfileAuthenticated, hasProfile } from '../../lib/profile';
import { authenticateWithBiometrics } from '../../lib/biometric';

// ── Phase labels ──────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  idle:       'Where to?',
  listening:  'Listening…',
  thinking:   'On it…',
  confirming: 'Confirm to book',
  done:       'Booked',
  error:      'Try again',
};

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ConverseScreen() {
  const {
    phase, setPhase,
    transcript, setTranscript,
    turns, addTurn,
    error, setError,
    agentId,
    userName,
    autoConfirmLimitUsdc,
    currencySymbol,
    currencyCode,
    setCurrency,
    setCurrentAgent,
    reset,
  } = useStore();

  // Pending plan — awaiting biometric confirmation
  const pendingPlanRef = useRef<{
    transcript: string;
    plan: ConciergePlanItem[];
    /** Scoped (non-sensitive) profile used in Phase 1 narration */
    travelProfile?: Record<string, unknown>;
    /** Full profile — only loaded for Phase 2 after biometric confirmation */
    fullProfile?: Record<string, unknown>;
    /** Total estimated cost across all plan items */
    totalPriceUsdc: number;
    /** Fiat display amount — what the user sees */
    fiatAmount: number;
    fiatSymbol: string;
    fiatCode: string;
  } | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [turns]);

  // ── Phase 1: plan ─────────────────────────────────────────────────────────

  const handleIntent = useCallback(async (text: string) => {
    if (!agentId) throw new Error('No agent identity. Please restart the app.');

    setTranscript(text);
    const userTurn = { role: 'user' as const, text, ts: Date.now() };
    addTurn(userTurn);
    await appendHistory(userTurn);

    setPhase('thinking');

    // Load travel profile for Phase 1 — preferences only, no identity data.
    // Full profile (legalName, email, phone, documents) is loaded AFTER biometric
    // confirmation in handleBiometricConfirm. This ensures sensitive data never
    // reaches memory before the user explicitly authorises the booking.
    let travelProfile: Record<string, unknown> | undefined;
    try {
      if (await hasProfile()) {
        const profile = await loadProfileRaw();
        if (profile) {
          // Phase 1: non-identity prefs only — railcard/class/nationality for narration personalisation
          travelProfile = {
            seatPreference:  profile.seatPreference,
            classPreference: profile.classPreference,
            railcardType:    profile.railcardType,
            indiaClassTier:  profile.indiaClassTier,
            nationality:     profile.nationality,
          };
        }
      }
    } catch {
      // No profile stored — proceed without
    }

    // Phase 1: get a plan from Claude — no hire fires yet
    const response = await planIntent({
      transcript:   text,
      hirerId:      agentId,
      travelProfile,
    });

    const meridianTurn = {
      role: 'meridian' as const,
      text: response.narration,
      ts:   Date.now(),
    };
    addTurn(meridianTurn);
    await appendHistory(meridianTurn);
    await speak(response.narration);

    // Persist detected currency to store (used everywhere in app)
    if (response.currencySymbol && response.currencyCode) {
      setCurrency(response.currencySymbol, response.currencyCode);
    }

    // If plan needs biometric confirmation, store it
    if (response.needsBiometric && response.plan && response.plan.length > 0) {
      const total      = response.estimatedPriceUsdc ?? 0;
      const fiatAmount = response.fiatAmount          ?? total;
      const fiatSymbol = response.currencySymbol      ?? currencySymbol;
      const fiatCode   = response.currencyCode        ?? currencyCode;
      // fullProfile is NOT stored here — it will be loaded after biometric in handleBiometricConfirm
      pendingPlanRef.current = {
        transcript: text, plan: response.plan, travelProfile, fullProfile: undefined,
        totalPriceUsdc: total, fiatAmount, fiatSymbol, fiatCode,
      };

      // Auto-confirm if total is within the spending limit (no fingerprint needed)
      if (total > 0 && total <= autoConfirmLimitUsdc) {
        await executePhase2(pendingPlanRef.current);
        return;
      }

      // Above limit — show confirmation card with price + fingerprint gate
      setPhase('confirming');
      return;
    }

    // No action needed (research, clarification, or error from Claude)
    setPhase('idle');
  }, [agentId, autoConfirmLimitUsdc]);

  // ── Shared Phase 2 executor ───────────────────────────────────────────────

  const executePhase2 = useCallback(async (pending: NonNullable<typeof pendingPlanRef.current>) => {
    setPhase('thinking');
    const { transcript: savedTranscript, plan, fullProfile } = pending;
    pendingPlanRef.current = null;

    try {
      const response = await executeIntent({
        transcript:    savedTranscript,
        hirerId:       agentId!,
        travelProfile: fullProfile,
        plan,
      });

      const meridianTurn = { role: 'meridian' as const, text: response.narration, ts: Date.now() };
      addTurn(meridianTurn);
      await appendHistory(meridianTurn);
      await speak(response.narration);

      if (response.actions.length > 0) {
        const firstAction = response.actions[0];
        setCurrentAgent({
          agentId:         firstAction.agentId,
          name:            firstAction.agentName,
          category:        firstAction.toolName,
          description:     firstAction.displayName,
          capabilities:    [],
          pricePerTaskUsd: firstAction.agreedPriceUsdc,
          trustScore:      0,
          grade:           'B',
          verified:        true,
          passportUrl:     `https://agentpay.gg/agent/${firstAction.agentId}`,
        });
        setPhase('done');
        const fiat   = pending.fiatAmount;
        const sym    = pending.fiatSymbol;
        const code   = pending.fiatCode;
        router.push(`/status/${firstAction.jobId}?fiatAmount=${fiat}&currencySymbol=${encodeURIComponent(sym)}&currencyCode=${code}`);
      } else {
        setPhase('idle');
      }
    } catch (e: any) {
      const msg = e.message ?? 'Booking failed. Please try again.';
      setError(msg);
      await speak(`Sorry — ${msg}`);
    }
  }, [agentId]);

  // ── Phase 2: biometric → execute ─────────────────────────────────────────

  const handleBiometricConfirm = useCallback(async () => {
    const pending = pendingPlanRef.current;
    if (!pending) return;

    const authed = await authenticateWithBiometrics('Confirm booking and payment');
    if (!authed) {
      await speak('Payment cancelled.');
      addTurn({ role: 'meridian', text: 'Payment cancelled.', ts: Date.now() });
      pendingPlanRef.current = null;
      setPhase('idle');
      return;
    }

    // Load full profile NOW — only after biometric success.
    // This is the first time legalName, email, phone, and documents enter memory.
    try {
      const fullProfile = await loadProfileAuthenticated();
      if (fullProfile) pending.fullProfile = fullProfile as unknown as Record<string, unknown>;
    } catch {
      // Biometric already succeeded — proceed without full profile if load fails
    }

    await executePhase2(pending);
  }, [agentId, executePhase2]);

  // ── Cancel confirmation ───────────────────────────────────────────────────

  const handleCancelConfirm = useCallback(async () => {
    pendingPlanRef.current = null;
    await speak('OK, cancelled.');
    addTurn({ role: 'meridian', text: 'OK, cancelled.', ts: Date.now() });
    setPhase('idle');
  }, []);

  // ── UPI pay (India only) ─────────────────────────────────────────────────

  const handleUpiPay = useCallback(async () => {
    const pending = pendingPlanRef.current;
    if (!pending) return;

    // fiatAmount is already in INR when currencyCode === 'INR'
    const amountInr = pending.fiatCode === 'INR'
      ? Math.round(pending.fiatAmount)
      : Math.round(pending.fiatAmount * 84); // fallback: convert USD→INR
    const upiDeepLink = `upi://pay?pa=agentpay@razorpay&pn=AgentPay&am=${amountInr}&cu=INR&tn=${encodeURIComponent('Train booking via Bro')}`;

    const canOpen = await Linking.canOpenURL(upiDeepLink);
    if (canOpen) {
      await Linking.openURL(upiDeepLink);
    } else {
      await speak('No UPI app found — use fingerprint to confirm instead.');
    }
  }, []);

  // ── Hold-to-talk (press = start recording, release = send) ──────────────
  // Minimum hold: 600ms. Shorter = accidental tap, reset silently.
  // recordingReadyRef guards the race where user releases before startRecording() completes.

  const pressStartRef    = useRef<number>(0);
  const recordingReadyRef = useRef<boolean>(false);

  const handlePressIn = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    await stopSpeaking();
    if (phase === 'error') reset();
    pressStartRef.current    = Date.now();
    recordingReadyRef.current = false;
    setPhase('listening');
    try {
      await startRecording();
      recordingReadyRef.current = true;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      setError('Microphone access denied. Go to Settings → Apps → Bro → Permissions → Microphone.');
    }
  }, [phase]);

  const handlePressOut = useCallback(async () => {
    if (phase !== 'listening') return;

    const heldMs = Date.now() - pressStartRef.current;

    // Too short OR recording not ready — cancel cleanly
    if (heldMs < 600 || !recordingReadyRef.current) {
      await stopRecording(); // safe to call even if null
      setPhase('idle');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhase('thinking');

    try {
      const uri = await stopRecording();
      if (!uri) { setPhase('idle'); return; }

      let text = '';
      try {
        text = await transcribeAudio(uri);
      } catch (e: any) {
        const msg = (e.message ?? '').toLowerCase();
        console.error('[bro/stt]', e.message);
        if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('abort')) {
          setError('Voice service is slow — try again.');
        } else if (msg.includes('401') || msg.includes('403') || msg.includes('not authorised')) {
          setError('Voice service not configured — contact support.');
        } else if (msg.includes('503') || msg.includes('not configured')) {
          setError('Voice service offline — try again in a moment.');
        } else if (msg.includes('empty') || msg.includes('missing') || msg.includes('hold')) {
          setError("Didn't catch that — hold and speak clearly.");
        } else if (msg.includes('network error') || msg.includes('network request')) {
          setError('Cannot reach voice service — check your connection.');
        } else if (msg.includes('502') || msg.includes('transcription error') || msg.includes('whisper')) {
          setError('Voice service error — please try again.');
        } else {
          // Show the real error in dev so we can diagnose it
          setError(__DEV__ ? `STT: ${e.message}` : 'Voice error — try again.');
        }
        return;
      }

      if (!text.trim()) {
        setError("Didn't catch that — hold and speak clearly.");
        return;
      }

      await handleIntent(text);
    } catch (e: any) {
      const msg = (e.message ?? '').toLowerCase();
      if (msg.includes('timed out') || msg.includes('timeout')) {
        setError('Bro took too long — hold to try again.');
      } else if (msg.includes('no connection') || msg.includes('internet')) {
        setError('No connection — check your internet and try again.');
      } else if (msg.includes('offline')) {
        setError('Service offline — try again in a moment.');
      } else {
        setError('Something went wrong — hold to try again.');
      }
    }
  }, [phase, handleIntent]);

  // ── Render ────────────────────────────────────────────────────────────────

  const phaseLabel = PHASE_LABEL[phase] ?? '';
  const isIdle     = phase === 'idle';
  const isError    = phase === 'error';
  const isBusy     = phase === 'thinking' || phase === 'done';
  const isConfirming = phase === 'confirming';
  const isIndia = (pendingPlanRef.current?.plan ?? []).some(p => p.toolName === 'book_train_india');

  return (
    <SafeAreaView style={styles.safe}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <View style={styles.headerDot} />
          <Text style={styles.headerTitle}>bro</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
          <Pressable onPress={() => router.push('/(main)/trips')} hitSlop={12}>
            <Ionicons name="time-outline" size={19} color={C.textMuted} />
          </Pressable>
          <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
            <Ionicons name="settings-outline" size={19} color={C.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* Conversation */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {turns.length === 0 && isIdle && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyGreeting}>
              {userName !== 'there' ? `Hello, ${userName}.` : 'Hello.'}
            </Text>
            <Text style={styles.emptyHint}>
              Hold the orb. Tell me where you're going.{'\n'}I'll handle the rest.
            </Text>
            <View style={styles.suggestions}>
              <Suggestion icon="train-outline"  text="London to Edinburgh, tomorrow morning" />
              <Suggestion icon="train-outline"  text="Next train from Manchester to Derby" />
              <Suggestion icon="subway-outline" text="Indiranagar to Whitefield by metro" />
            </View>
          </View>
        )}

        {turns.map((turn, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              turn.role === 'user' ? styles.bubbleUser : styles.bubbleMeridian,
            ]}
          >
            {turn.role === 'meridian' && (
              <View style={styles.bubbleAvatar}>
                <View style={styles.avatarDot} />
              </View>
            )}
            <Text style={[
              styles.bubbleText,
              turn.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextMeridian,
            ]}>
              {turn.text}
            </Text>
          </View>
        ))}

        {isConfirming && (() => {
          const fiat    = pendingPlanRef.current?.fiatAmount ?? 0;
          const sym     = pendingPlanRef.current?.fiatSymbol ?? currencySymbol;
          const plan    = pendingPlanRef.current?.plan ?? [];
          const planInput = (plan[0]?.input ?? {}) as Record<string, string>;
          const tripOrigin = planInput.origin ?? planInput.from ?? '';
          const tripDest   = planInput.destination ?? planInput.to ?? '';
          const tripDesc   = tripOrigin && tripDest
            ? `${tripOrigin} → ${tripDest}`
            : plan[0]?.displayName ?? null;
          const finalLegSummary = plan[0]?.finalLegSummary ?? null;
          const dataSource = plan[0]?.dataSource;
          const sourceLabel = dataSource === 'darwin_live'           ? 'National Rail · Live'
                            : dataSource === 'national_rail_scheduled' ? 'National Rail · Scheduled'
                            : dataSource === 'irctc_live'             ? 'IRCTC · Live'
                            : dataSource === 'estimated'              ? 'Estimated fare'
                            : null;
          // Format: no decimals for INR (large numbers), 2 decimals for others
          const fiatStr = sym === '₹'
            ? Math.round(fiat).toLocaleString('en-IN')
            : fiat.toFixed(2);
          const priceLabel = fiat > 0 ? `${sym}${fiatStr}` : null;
          return (
            <BlurView intensity={25} tint="dark" style={styles.confirmCard}>
              {tripDesc && (
                <Text style={styles.confirmTrip} numberOfLines={2}>{tripDesc}</Text>
              )}
              {sourceLabel && (
                <View style={styles.sourceBadge}>
                  <Text style={styles.sourceBadgeText}>{sourceLabel}</Text>
                </View>
              )}
              {priceLabel && (
                <Text style={styles.confirmPrice}>{priceLabel}</Text>
              )}
              {finalLegSummary && (
                <View style={styles.finalLegRow}>
                  <Ionicons name="subway-outline" size={13} color={C.sky} style={{ marginRight: 6 }} />
                  <Text style={styles.finalLegText}>{finalLegSummary}</Text>
                </View>
              )}
              <Pressable style={styles.confirmBtn} onPress={handleBiometricConfirm}>
                <LinearGradient
                  colors={[C.emDim, C.emMid]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.confirmBtnGrad}
                >
                  <Ionicons name="finger-print-outline" size={20} color={C.emBright} />
                  <Text style={styles.confirmText}>Confirm with fingerprint</Text>
                </LinearGradient>
              </Pressable>
              {isIndia && (
                <View style={styles.upiSection}>
                  <Text style={styles.upiLabel}>or pay with UPI</Text>
                  <Pressable style={styles.upiBtn} onPress={handleUpiPay}>
                    <Ionicons name="qr-code-outline" size={16} color="#f97316" />
                    <Text style={styles.upiBtnText}>Open UPI App</Text>
                  </Pressable>
                  <Text style={styles.upiHint}>Google Pay · PhonePe · Paytm · BHIM</Text>
                </View>
              )}
              <Pressable style={styles.confirmCancel} onPress={handleCancelConfirm}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
            </BlurView>
          );
        })()}

        {isError && error && (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={16} color="#f87171" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={{ height: 260 }} />
      </ScrollView>

      {/* Orb + label */}
      <View style={styles.orbArea}>
        <Text style={[styles.phaseLabel, { color: PHASE_LABEL_COLOR[phase] ?? C.textMuted }]}>
          {phaseLabel}
        </Text>

        <OrbAnimation
          phase={phase}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isBusy || isConfirming}
        />

        {(isIdle || isError) && turns.length > 0 && (
          <Pressable onPress={() => reset()} style={styles.clearBtn} hitSlop={12}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        )}
      </View>

    </SafeAreaView>
  );
}

// ── Suggestion chip ───────────────────────────────────────────────────────────

function Suggestion({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={suggStyles.chip}>
      <View style={suggStyles.iconWrap}>
        <Ionicons name={icon as any} size={13} color={C.em} />
      </View>
      <Text style={suggStyles.text}>{text}</Text>
    </View>
  );
}

const suggStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: C.emDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 13, color: C.textSecondary, letterSpacing: 0.1 },
});

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  headerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.em,
    shadowColor: C.em,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.3,
  },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },

  emptyState:    { paddingTop: 44, paddingBottom: 20 },
  emptyGreeting: {
    fontSize: 34,
    fontWeight: '800',
    color: C.textPrimary,
    marginBottom: 10,
    letterSpacing: -1,
    lineHeight: 40,
  },
  emptyHint: {
    fontSize: 16,
    color: C.textMuted,
    marginBottom: 32,
    lineHeight: 26,
    letterSpacing: 0.1,
  },
  suggestions: {},

  bubble: {
    maxWidth: '85%',
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
  },
  bubbleUser:     { alignSelf: 'flex-end' },
  bubbleMeridian: { alignSelf: 'flex-start' },
  bubbleAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.emDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    borderWidth: 1,
    borderColor: C.emGlow,
  },
  avatarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.emBright,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 23,
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 11,
    overflow: 'hidden',
  },
  bubbleTextUser: {
    backgroundColor: C.indigoDim,
    color: '#dde4ff',
    borderBottomRightRadius: 3,
  },
  bubbleTextMeridian: {
    backgroundColor: C.surface,
    color: C.textSecondary,
    borderBottomLeftRadius: 3,
    borderLeftWidth: 2,
    borderLeftColor: C.em,
  },

  confirmCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.emGlow,
    borderRadius: 20,
    padding: 22,
    marginBottom: 12,
    alignSelf: 'stretch',
    gap: 14,
    shadowColor: C.em,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 40,
    elevation: 12,
  },
  confirmTrip: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  sourceBadge: {
    alignSelf: 'center',
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.borderMd,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  sourceBadgeText: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  confirmPrice: {
    fontSize: 38,
    fontWeight: '800',
    color: C.textPrimary,
    textAlign: 'center',
    letterSpacing: -1.5,
  },
  finalLegRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: C.skyDim,
    borderWidth: 1,
    borderColor: '#1a3a50',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  finalLegText: {
    flex: 1,
    fontSize: 12,
    color: C.sky,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  confirmBtn: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  confirmBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  confirmText: { fontSize: 15, color: C.emBright, fontWeight: '700', letterSpacing: 0.2 },
  confirmCancel: { alignItems: 'center', paddingVertical: 8 },
  confirmCancelText: { fontSize: 13, color: C.textDim },

  upiSection:  { marginTop: 4, alignItems: 'center', gap: 8 },
  upiLabel:    { fontSize: 12, color: C.textMuted, letterSpacing: 0.5 },
  upiBtn:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1c1008', borderWidth: 1, borderColor: C.amberMid, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  upiBtnText:  { fontSize: 14, fontWeight: '600', color: '#f97316' },
  upiHint:     { fontSize: 11, color: C.textDim },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#080505',
    borderWidth: 1,
    borderColor: C.redMid,
    borderLeftWidth: 3,
    borderLeftColor: C.red,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 13, color: '#fca5a5', lineHeight: 20 },

  orbArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 50,
    paddingTop: 18,
    backgroundColor: 'rgba(3,7,15,0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  phaseLabel: {
    fontSize: 11,
    marginBottom: 16,
    letterSpacing: 2,
    fontWeight: '600',
    textTransform: 'uppercase',
    // color injected inline per-phase
  },
  clearBtn: { marginTop: 18 },
  clearBtnText: { fontSize: 13, color: C.textDim, letterSpacing: 0.3 },
});
