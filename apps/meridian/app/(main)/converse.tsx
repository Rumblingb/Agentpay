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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  SafeAreaView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C, PHASE_LABEL_COLOR } from '../../lib/theme';

import { OrbAnimation } from '../../components/OrbAnimation';
import { useStore } from '../../lib/store';
import { startRecording, stopRecording, transcribeAudio } from '../../lib/speech';
import { speakBro, cancelSpeech } from '../../lib/tts';
import { appendHistory, loadActiveTrip, type ActiveTrip } from '../../lib/storage';
import { planIntent, executeIntent, type ConciergePlanItem } from '../../lib/concierge';
import { loadProfileRaw, loadProfileAuthenticated, hasProfile } from '../../lib/profile';
import { authenticateWithBiometrics } from '../../lib/biometric';
import { getNearestStation } from '../../lib/location';
import type { StationGeo } from '../../lib/stationGeo';
import { fetchRate } from '../../lib/currency';
import { tripCards, type ProactiveCard, type TripContext } from '../../lib/trip';

type MarketNationality = 'uk' | 'india' | 'other';

const MARKET_SUGGESTIONS: Record<MarketNationality, string[]> = {
  uk: [
    'London to Edinburgh, tomorrow morning',
    'Next train from Manchester to Derby',
    'Best route from Birmingham to Euston tonight',
  ],
  india: [
    'Delhi to Agra tomorrow morning',
    'Mumbai to Pune this evening',
    'Indiranagar to Whitefield by metro',
  ],
  other: [
    'Book a train tomorrow morning',
    'Find the fastest rail option into the city',
    'Check the next departure and fare',
  ],
};

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

const VOICE_ENABLED_KEY = 'bro.voiceEnabled';

function getCountdown(departureTime: string | null | undefined): string | null {
  if (!departureTime) return null;
  const d = new Date(departureTime);
  if (isNaN(d.getTime())) return null;
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0 || diffMs > 24 * 60 * 60 * 1000) return null;
  const hours = Math.floor(diffMs / 3_600_000);
  const mins  = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0)  return `${mins}m`;
  return 'Now';
}

function getConfirmBaseGbp(plan: ConciergePlanItem[]): number | null {
  const total = plan.reduce((sum, item) => {
    // India rail has no GBP equivalent — skip to avoid labelling USDC as £
    if (item.toolName === 'book_train_india') return sum;
    const trainFare = (item as ConciergePlanItem & {
      trainDetails?: { estimatedFareGbp?: number };
    }).trainDetails?.estimatedFareGbp;
    if (typeof trainFare === 'number') {
      return sum + trainFare;
    }
    return sum + item.estimatedPriceUsdc;
  }, 0);

  return total > 0 ? total : null;
}

function formatConfirmAmount(amount: number, currency: string): string {
  if (currency === 'INR') {
    return Math.round(amount).toLocaleString('en-IN');
  }
  return amount.toFixed(2);
}

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
    homeStation,
    workStation,
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
  const [marketNationality, setMarketNationality] = useState<MarketNationality>('uk');
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [, setCountdownTick] = useState(0);
  const [nearestStation, setNearestStation] = useState<StationGeo | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [confirmFxRate, setConfirmFxRate] = useState<number | null>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [turns]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const profile = await loadProfileRaw();
        if (!active || !profile?.nationality) return;
        setMarketNationality(profile.nationality);
      } catch {
        // Keep the default UK launch market if the profile is unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const trip = await loadActiveTrip();
      if (active) setActiveTrip(trip);
    })();
    return () => {
      active = false;
    };
  }, []));

  // Detect nearest station on mount (fire-and-forget, best-effort)
  useEffect(() => {
    let active = true;
    getNearestStation().then((s) => {
      if (active) setNearestStation(s);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setCountdownTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(VOICE_ENABLED_KEY);
        if (!active || stored == null) return;
        setVoiceEnabled(stored !== 'false');
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (phase !== 'confirming') {
      setConfirmFxRate(null);
      return () => {
        active = false;
      };
    }

    const pending = pendingPlanRef.current;
    const targetCurrency = pending?.fiatCode ?? currencyCode;
    const baseGbp = getConfirmBaseGbp(pending?.plan ?? []);

    if (!baseGbp || targetCurrency === 'GBP') {
      setConfirmFxRate(null);
      return () => {
        active = false;
      };
    }

    fetchRate('GBP', targetCurrency)
      .then((rate) => {
        if (active) setConfirmFxRate(rate);
      })
      .catch(() => {
        if (active) setConfirmFxRate(null);
      });

    return () => {
      active = false;
    };
  }, [phase, currencyCode]);

  const speakIfEnabled = useCallback(async (text: string) => {
    if (!voiceEnabled) return;
    await speakBro(text);
  }, [voiceEnabled]);

  // ── Phase 1: plan ─────────────────────────────────────────────────────────

  const handleIntent = useCallback(async (text: string) => {
    if (!agentId) throw new Error('Bro is not ready yet. Please restart the app.');

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
          // Phase 1: non-identity prefs only — railcard/class/nationality for narration personalisation.
          // familyMembers included (no documents or contact details) so Claude can resolve names.
          travelProfile = {
            seatPreference:  profile.seatPreference,
            classPreference: profile.classPreference,
            railcardType:    profile.railcardType,
            indiaClassTier:  profile.indiaClassTier,
            nationality:     profile.nationality,
            // Safe to include — names, relationships, ages, railcards only (no passport numbers here)
            familyMembers:   profile.familyMembers?.map(m => ({
              id:           m.id,
              name:         m.name,
              relationship: m.relationship,
              dateOfBirth:  m.dateOfBirth,
              railcard:     m.railcard,
              nationality:  m.nationality,
            })),
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
    await speakIfEnabled(response.narration);

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
  }, [agentId, autoConfirmLimitUsdc, speakIfEnabled]);

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
      await speakIfEnabled(response.narration);

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
        const qs = new URLSearchParams({
          fiatAmount: String(fiat),
          currencySymbol: sym,
          currencyCode: code,
        });
        if (firstAction.tripContext) {
          qs.set('tripContext', JSON.stringify(firstAction.tripContext));
        }
        if ((firstAction as any).shareToken) {
          qs.set('shareToken', (firstAction as any).shareToken);
        }
        router.push(`/status/${firstAction.jobId}?${qs.toString()}`);
      } else {
        setPhase('idle');
      }
    } catch (e: any) {
      const msg = e.message ?? 'Booking failed. Please try again.';
      setError(msg);
      await speakIfEnabled(`Sorry — ${msg}`);
    }
  }, [agentId, speakIfEnabled]);

  // ── Phase 2: biometric → execute ─────────────────────────────────────────

  const handleBiometricConfirm = useCallback(async () => {
    const pending = pendingPlanRef.current;
    if (!pending) return;

    const authed = await authenticateWithBiometrics('Confirm booking and payment');
    if (!authed) {
      await speakIfEnabled('Payment cancelled.');
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
  }, [agentId, executePhase2, speakIfEnabled]);

  // ── Cancel confirmation ───────────────────────────────────────────────────

  const handleCancelConfirm = useCallback(async () => {
    pendingPlanRef.current = null;
    await speakIfEnabled('OK, cancelled.');
    addTurn({ role: 'meridian', text: 'OK, cancelled.', ts: Date.now() });
    setPhase('idle');
  }, [speakIfEnabled]);

  // ── UPI pay (India only) ─────────────────────────────────────────────────

  const handleUpiPay = useCallback(async () => {
    await speakIfEnabled('Payment happens after Bro creates the booking request.');
  }, [speakIfEnabled]);

  // ── Hold-to-talk (press = start recording, release = send) ──────────────
  // Minimum hold: 600ms. Shorter = accidental tap, reset silently.
  // recordingReadyRef guards the race where user releases before startRecording() completes.

  const pressStartRef    = useRef<number>(0);
  const recordingReadyRef = useRef<boolean>(false);

  const handlePressIn = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    cancelSpeech();
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
  }, [phase, reset]);

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
          setError('Voice service is unavailable right now — try again shortly.');
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

  const handleShortcutIntent = useCallback(async (destination: string, kind: 'home' | 'work') => {
    if (!nearestStation) return;
    const text =
      kind === 'home'
        ? `Get me home from ${nearestStation.name} to ${destination}`
        : `Get to work from ${nearestStation.name} to ${destination}`;
    await handleIntent(text);
  }, [handleIntent, nearestStation]);

  const handleVoiceToggle = useCallback(async () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    if (!next) cancelSpeech();
    try {
      await AsyncStorage.setItem(VOICE_ENABLED_KEY, String(next));
    } catch {}
  }, [voiceEnabled]);

  // ── Render ────────────────────────────────────────────────────────────────

  const phaseLabel = PHASE_LABEL[phase] ?? '';
  const isIdle     = phase === 'idle';
  const isError    = phase === 'error';
  const isBusy     = phase === 'thinking' || phase === 'done';
  const isConfirming = phase === 'confirming';
  const isIndia = (pendingPlanRef.current?.plan ?? []).some(p => p.toolName === 'book_train_india');
  const idleSuggestions = MARKET_SUGGESTIONS[marketNationality];

  // Time-aware greeting
  const timeGreeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  // Last route suggestion — "Same route as last time?"
  const lastRouteHint = activeTrip?.fromStation && activeTrip?.toStation && activeTrip.status === 'ticketed'
    ? `${activeTrip.fromStation} → ${activeTrip.toStation} again?`
    : null;
  return (
    <SafeAreaView style={styles.safe}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <View style={styles.headerDot} />
          <Text style={styles.headerTitle}>bro</Text>
        </View>
        <View style={styles.headerActions}>
          {nearestStation && (
            <View style={styles.nearBadge}>
              <Text style={styles.nearBadgeText}>{`📍 ${nearestStation.name}`}</Text>
            </View>
          )}
          <Pressable onPress={() => { void handleVoiceToggle(); }} hitSlop={12} style={styles.headerIconBtn}>
            <Ionicons
              name={voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
              size={19}
              color={voiceEnabled ? C.emBright : C.textMuted}
            />
          </Pressable>
          <Pressable onPress={() => router.push('/(main)/map')} hitSlop={12} style={styles.headerIconBtn}>
            <Ionicons name="map-outline" size={19} color={C.textMuted} />
          </Pressable>
          <Pressable onPress={() => router.push('/(main)/trips')} hitSlop={12} style={styles.headerIconBtn}>
            <Ionicons name="time-outline" size={19} color={C.textMuted} />
          </Pressable>
          <Pressable onPress={() => router.push('/settings')} hitSlop={12} style={styles.headerIconBtn}>
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
            <Text style={styles.emptyEyebrow}>Voice-first rail concierge</Text>
            <Text style={styles.emptyGreeting}>
              {userName !== 'there' ? `${timeGreeting}, ${userName}.` : `${timeGreeting}.`}
            </Text>
            <Text style={styles.emptyHint}>
              {lastRouteHint
                ? `${lastRouteHint}\nHold the orb and I'll sort it.`
                : `Hold the orb. Tell me where you're going.\nBro will handle the rest.`}
            </Text>
            {activeTrip && (
              <Pressable
                onPress={() => {
                  if ((activeTrip.status === 'securing' || activeTrip.status === 'attention') && activeTrip.jobId) {
                    const params: Record<string, string> = { jobId: activeTrip.jobId };
                    if (activeTrip.fiatAmount != null) params.fiatAmount = String(activeTrip.fiatAmount);
                    if (activeTrip.currencySymbol) params.currencySymbol = activeTrip.currencySymbol;
                    if (activeTrip.currencyCode) params.currencyCode = activeTrip.currencyCode;
                    router.push({ pathname: '/(main)/status/[jobId]', params });
                    return;
                  }

                  router.push({
                    pathname: '/(main)/receipt/[intentId]',
                    params: {
                      intentId: activeTrip.intentId,
                      bookingRef: activeTrip.bookingRef ?? undefined,
                      fromStation: activeTrip.fromStation ?? undefined,
                      toStation: activeTrip.toStation ?? undefined,
                      departureTime: activeTrip.departureTime ?? undefined,
                      platform: activeTrip.platform ?? undefined,
                      operator: activeTrip.operator ?? undefined,
                      finalLegSummary: activeTrip.finalLegSummary ?? undefined,
                      fiatAmount: activeTrip.fiatAmount != null ? String(activeTrip.fiatAmount) : undefined,
                      currencySymbol: activeTrip.currencySymbol ?? undefined,
                      currencyCode: activeTrip.currencyCode ?? undefined,
                    },
                  });
                }}
                style={styles.activeTripCard}
              >
                <View style={styles.activeTripTop}>
                  <View style={[
                    styles.activeTripPill,
                    activeTrip.status === 'attention' && styles.activeTripPillWarn,
                    activeTrip.status === 'ticketed' && styles.activeTripPillDone,
                  ]}>
                    <Text style={[
                      styles.activeTripPillText,
                      activeTrip.status === 'attention' && styles.activeTripPillTextWarn,
                      activeTrip.status === 'ticketed' && styles.activeTripPillTextDone,
                    ]}>
                      {activeTrip.status === 'securing'
                        ? 'In progress'
                        : activeTrip.status === 'ticketed'
                        ? 'Latest journey'
                        : 'Needs attention'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                </View>
                <Text style={styles.activeTripTitle} numberOfLines={1}>{activeTrip.title}</Text>
                <Text style={styles.activeTripMeta} numberOfLines={2}>
                  {activeTrip.status === 'securing'
                    ? 'Bro is securing this journey now.'
                    : activeTrip.finalLegSummary
                    ? activeTrip.finalLegSummary
                    : (() => {
                        const countdown = getCountdown(activeTrip.departureTime);
                        const platformPart = activeTrip.platform ? `Platform ${activeTrip.platform}` : null;
                        if (countdown) return [platformPart ? `Leaves in ${countdown} · ${platformPart}` : `Leaves in ${countdown}`].join('');
                        return [activeTrip.departureTime, platformPart].filter(Boolean).join(' · ') || 'Open for journey details';
                      })()}
                </Text>
              </Pressable>
            )}
            <View style={styles.suggestionsCard}>
              <View style={styles.suggestionsHeader}>
                <Text style={styles.suggestionsEyebrow}>Try one of these</Text>
                <Text style={styles.suggestionsHint}>One sentence is enough. Bro will work out the route.</Text>
              </View>
              <View style={styles.suggestions}>
                {idleSuggestions.map((suggestion, index) => (
                  <Suggestion
                    key={suggestion}
                    icon={marketNationality === 'india' && index === 2 ? 'subway-outline' : 'train-outline'}
                    text={suggestion}
                  />
                ))}
              </View>
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
          const code    = pendingPlanRef.current?.fiatCode ?? currencyCode;
          const plan    = pendingPlanRef.current?.plan ?? [];
          // Family members from Phase 1 profile (non-sensitive — names + relationships only)
          const tpFam   = (pendingPlanRef.current?.travelProfile?.familyMembers as Array<{ name: string; relationship: string; railcard?: string }> | undefined) ?? [];
          const passengers = tpFam.length > 0
            ? [{ name: 'You', relationship: 'adult' as const }, ...tpFam]
            : null;
          const planInput = (plan[0]?.input ?? {}) as Record<string, string>;
          const tripOrigin = planInput.origin ?? planInput.from ?? '';
          const tripDest   = planInput.destination ?? planInput.to ?? '';
          const tripContext = (plan[0]?.tripContext ?? null) as TripContext | null;
          const tripDesc   = tripContext?.title ?? (tripOrigin && tripDest ? `${tripOrigin} -> ${tripDest}` : plan[0]?.displayName ?? null); /*
            ? `${tripOrigin} → ${tripDest}`
          */ const finalLegSummary = tripContext?.finalLegSummary ?? plan[0]?.finalLegSummary ?? null;
          const routeData    = tripContext?.routeData    ?? plan[0]?.routeData    ?? null;
          const nearbyPlaces = tripContext?.nearbyPlaces ?? plan[0]?.nearbyPlaces ?? null;
          const cards = tripCards(tripContext);
          const dataSource = plan[0]?.dataSource;
          const sourceLabel = dataSource === 'darwin_live'           ? 'National Rail · Live'
                            : dataSource === 'national_rail_scheduled' ? 'National Rail · Scheduled'
                            : dataSource === 'irctc_live'             ? 'IRCTC · Live'
                            : dataSource === 'estimated'              ? 'Estimated fare'
                            : null;
          const baseGbp = getConfirmBaseGbp(plan);
          const localAmount = baseGbp && confirmFxRate ? baseGbp * confirmFxRate : null;
          const priceLabel = (() => {
            if (code !== 'GBP' && baseGbp) {
              const baseLabel = `£${formatConfirmAmount(baseGbp, 'GBP')}`;
              if (localAmount) {
                return `${baseLabel} · ${sym}${formatConfirmAmount(localAmount, code)}`;
              }
              return baseLabel;
            }
            if (fiat > 0) {
              return `${sym}${formatConfirmAmount(fiat, code)}`;
            }
            return null;
          })();
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
              {passengers && passengers.length > 1 && (
                <View style={styles.passengerList}>
                  {passengers.map((p, i) => {
                    // Estimate per-person share (simplified — equal adult split, child = half)
                    const isChild = p.relationship === 'child' || p.relationship === 'infant';
                    const adultCount  = passengers.filter(x => x.relationship !== 'child' && x.relationship !== 'infant').length;
                    const childCount  = passengers.filter(x => x.relationship === 'child' || x.relationship === 'infant').length;
                    const totalUnits  = adultCount + childCount * 0.5;
                    const perUnit     = fiat / totalUnits;
                    const personFare  = isChild ? perUnit * 0.5 : perUnit;
                    return (
                      <View key={i} style={styles.passengerRow}>
                        <View style={styles.passengerPill}>
                          <Text style={styles.passengerPillText}>
                            {p.relationship === 'infant' ? '👶' : p.relationship === 'child' ? '🧒' : '🧑'} {p.name}
                          </Text>
                        </View>
                        <Text style={styles.passengerFare}>
                          {sym}{formatConfirmAmount(personFare, code)}
                          {isChild ? ' (child)' : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 11, color: '#6b7280' }}>Service fee </Text>
                <View style={{ backgroundColor: '#052e16', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 11, color: '#4ade80', fontWeight: '600' }}>Free · Beta</Text>
                </View>
              </View>
              <Text style={styles.confirmReason}>
                {isIndia
                  ? 'Best balance of speed, certainty, and payment flow for this trip.'
                  : 'Best balance of timing, fare, and journey simplicity.'}
              </Text>
              {cards.length > 0 && (
                <View style={styles.proactiveCardList}>
                  {cards.slice(0, 2).map((card) => (
                    <ProactiveCardRow key={card.id} card={card} />
                  ))}
                </View>
              )}
              {finalLegSummary && (
                <View style={styles.finalLegRow}>
                  <Ionicons name="subway-outline" size={13} color={C.sky} style={{ marginRight: 6 }} />
                  <Text style={styles.finalLegText}>{finalLegSummary}</Text>
                </View>
              )}
              {routeData && (
                <Pressable
                  style={styles.viewMapBtn}
                  onPress={() => router.push({
                    pathname: '/(main)/map',
                    params: { routeData: JSON.stringify(routeData) },
                  })}
                >
                  <Ionicons name="map-outline" size={14} color={C.sky} style={{ marginRight: 6 }} />
                  <Text style={styles.viewMapText}>View on Map</Text>
                </Pressable>
              )}
              {!routeData && nearbyPlaces && nearbyPlaces.length > 0 && (
                <Pressable
                  style={styles.viewMapBtn}
                  onPress={() => router.push({
                    pathname: '/(main)/map',
                    params: { places: JSON.stringify(nearbyPlaces) },
                  })}
                >
                  <Ionicons name="map-outline" size={14} color={C.sky} style={{ marginRight: 6 }} />
                  <Text style={styles.viewMapText}>Explore on Map</Text>
                </Pressable>
              )}
              <Pressable style={styles.confirmBtn} onPress={handleBiometricConfirm}>
                <LinearGradient
                  colors={[C.emDim, C.emMid]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.confirmBtnGrad}
                >
                  <Ionicons name="finger-print-outline" size={20} color={C.emBright} />
                  <Text style={styles.confirmText}>Book this journey</Text>
                </LinearGradient>
              </Pressable>
              {isIndia && (
                <View style={styles.upiSection}>
                  <Text style={styles.upiLabel}>India payments happen on the next screen</Text>
                  <Pressable style={styles.upiBtn} onPress={handleUpiPay}>
                    <Ionicons name="qr-code-outline" size={16} color="#f97316" />
                    <Text style={styles.upiBtnText}>Why</Text>
                  </Pressable>
                  <Text style={styles.upiHint}>Bro creates the job first, then collects UPI against that job.</Text>
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
        {nearestStation && (homeStation || workStation) && (isIdle || isError) && (
          <View style={styles.shortcutRow}>
            {homeStation && (
              <Pressable
                style={styles.shortcutBtn}
                onPress={() => { void handleShortcutIntent(homeStation, 'home'); }}
              >
                <Ionicons name="home-outline" size={13} color="#94a3b8" />
                <Text style={styles.shortcutBtnText}>Get me home</Text>
              </Pressable>
            )}
            {workStation && (
              <Pressable
                style={styles.shortcutBtn}
                onPress={() => { void handleShortcutIntent(workStation, 'work'); }}
              >
                <Ionicons name="business-outline" size={13} color="#94a3b8" />
                <Text style={styles.shortcutBtnText}>Get to work</Text>
              </Pressable>
            )}
          </View>
        )}

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

function ProactiveCardRow({ card }: { card: ProactiveCard }) {
  const accent = card.severity === 'warning' ? '#f59e0b' : card.severity === 'success' ? '#4ade80' : C.sky;
  return (
    <View style={[styles.proactiveCard, { borderColor: `${accent}33` }]}>
      <View style={[styles.proactiveDot, { backgroundColor: accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.proactiveTitle}>{card.title}</Text>
        <Text style={styles.proactiveBody}>{card.body}</Text>
      </View>
    </View>
  );
}

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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  nearBadge: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  nearBadgeText: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20 },

  emptyState:    { paddingTop: 32, paddingBottom: 20 },
  emptyEyebrow: {
    fontSize: 11,
    color: C.emBright,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
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
    marginBottom: 18,
    lineHeight: 26,
    letterSpacing: 0.1,
  },
  activeTripCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderMd,
    borderRadius: 18,
    padding: 16,
    marginBottom: 22,
  },
  activeTripTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  activeTripPill: {
    backgroundColor: C.indigoDim,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  activeTripPillWarn: {
    backgroundColor: '#2b1111',
  },
  activeTripPillDone: {
    backgroundColor: '#0c2417',
  },
  activeTripPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b8c4ff',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  activeTripPillTextWarn: {
    color: '#fca5a5',
  },
  activeTripPillTextDone: {
    color: '#86efac',
  },
  activeTripTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  activeTripMeta: {
    fontSize: 13,
    color: C.textMuted,
    lineHeight: 19,
  },
  suggestionsCard: {
    marginTop: 2,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 16,
  },
  suggestionsHeader: {
    marginBottom: 10,
  },
  suggestionsEyebrow: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  suggestionsHint: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 19,
  },
  suggestions: {},
  shortcutRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 14,
  },
  shortcutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shortcutBtnText: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },

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
  confirmReason: {
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: -6,
  },
  proactiveCardList: {
    gap: 8,
  },
  proactiveCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  proactiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  proactiveTitle: {
    fontSize: 12,
    color: C.textPrimary,
    fontWeight: '700',
    marginBottom: 2,
  },
  proactiveBody: {
    fontSize: 12,
    color: C.textMuted,
    lineHeight: 17,
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
  viewMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
    alignSelf: 'flex-start',
  },
  viewMapText: { fontSize: 13, color: C.sky, fontWeight: '500' },
  passengerList: { marginBottom: 10, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 10 },
  passengerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  passengerPill: { backgroundColor: '#0f172a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#1e293b' },
  passengerPillText: { fontSize: 12, color: '#f8fafc' },
  passengerFare: { fontSize: 12, color: '#94a3b8' },
});
