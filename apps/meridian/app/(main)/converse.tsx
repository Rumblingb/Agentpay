/**
 * Converse — the Ace concierge screen
 *
 * Flow:
 *   Hold to talk → Whisper STT → Phase 1 (plan, no hire)
 *   → Ace speaks price → fingerprint gate
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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { loadProfileRaw, loadProfileAuthenticated, hasProfile, type TravelProfile } from '../../lib/profile';
import { authenticateWithBiometrics } from '../../lib/biometric';
import { getNearestStation } from '../../lib/location';
import type { StationGeo } from '../../lib/stationGeo';
import { fetchRate } from '../../lib/currency';
import { formatMoneyAmount, isZeroDecimalCurrency } from '../../lib/money';
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
    'Tokyo to Osaka tomorrow, Shinkansen',
    'London to Edinburgh cheapest — bus or train?',
    'Bangkok to Chiang Mai tomorrow',
    'New York to Washington fastest',
    'Seoul to Busan on KTX Friday',
    'Singapore to Kuala Lumpur by bus',
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

type BookingReadinessTone = 'ready' | 'warning';

type BookingReadinessItem = {
  label: string;
  detail: string;
  tone: BookingReadinessTone;
};

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? trimmed).trim();
}

function speechPreview(text: string): string | null {
  const lead = firstSentence(text);
  if (!lead) return null;
  return lead.length <= 140 ? lead : null;
}

function shouldAutoSpeak(params: {
  narration: string;
  hasPlan?: boolean;
  needsBiometric?: boolean;
  phase: 'plan' | 'execute' | 'error' | 'system';
}): boolean {
  const preview = speechPreview(params.narration);
  if (!preview) return false;
  if (params.phase === 'error') return true;
  if (params.phase === 'system') return false;
  if (params.phase === 'plan' && params.hasPlan && params.needsBiometric) return false;
  if (params.phase === 'execute' && params.hasPlan) return false;
  return true;
}

function personalizedIdleSuggestions(params: {
  market: MarketNationality;
  nearestStation?: string | null;
  homeStation?: string | null;
  workStation?: string | null;
}): string[] {
  const base = MARKET_SUGGESTIONS[params.market];
  const picks: string[] = [];

  if (params.homeStation && params.nearestStation && params.homeStation !== params.nearestStation) {
    picks.push(`${params.nearestStation} to ${params.homeStation}`);
  }
  if (params.workStation && params.nearestStation && params.workStation !== params.nearestStation) {
    picks.push(`${params.nearestStation} to ${params.workStation}`);
  }

  const hour = new Date().getHours();
  if (params.market === 'uk' && hour >= 16) {
    picks.push('Best route home tonight');
  } else if (params.market === 'india' && hour >= 16) {
    picks.push('Fastest way home tonight');
  }

  for (const suggestion of base) {
    if (!picks.includes(suggestion)) picks.push(suggestion);
    if (picks.length >= 3) break;
  }

  return picks.slice(0, 3);
}

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

function activeTripStatusCopy(activeTrip: ActiveTrip): { pill: string; body: string } {
  if (activeTrip.status === 'securing') {
    return {
      pill: 'Booking in progress',
      body: 'Ace is lining this trip up now. Open it for live progress and anything that still needs you.',
    };
  }

  if (activeTrip.status === 'attention') {
    return {
      pill: 'Journey paused',
      body: 'Something changed or still needs you. Open it and Ace will guide the next step.',
    };
  }

  const countdown = getCountdown(activeTrip.departureTime);
  const platformPart = activeTrip.platform ? `Platform ${activeTrip.platform}` : null;
  const timingLine = countdown
    ? platformPart
      ? `Leaves in ${countdown} · ${platformPart}`
      : `Leaves in ${countdown}`
    : [activeTrip.departureTime, platformPart].filter(Boolean).join(' · ');

  return {
    pill: 'Latest journey',
    body: activeTrip.finalLegSummary || timingLine || 'Open for journey details',
  };
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

function buildBookingReadiness(params: {
  profile: TravelProfile | null;
  plan: ConciergePlanItem[];
  fiatAmount: number;
  autoConfirmLimitUsdc: number;
}): BookingReadinessItem[] {
  const { profile, plan, fiatAmount, autoConfirmLimitUsdc } = params;
  const hasRailLeg = plan.some((item) => item.toolName === 'book_train' || item.toolName === 'book_train_india');
  const hasFlightLeg = plan.some((item) => !!item.flightDetails);
  const familyMembers = profile?.familyMembers ?? [];
  const namelessFamily = familyMembers.filter((member) => !member.name?.trim()).length;
  const missingFlightDob = hasFlightLeg
    ? familyMembers.filter((member) => member.relationship !== 'infant' && !member.dateOfBirth).length
    : 0;

  return [
    profile?.legalName?.trim() && profile?.email?.trim() && profile?.phone?.trim()
      ? {
          label: 'Checkout details ready',
          detail: 'Ace has the name, email, and phone it needs to move without stopping.',
          tone: 'ready',
        }
      : {
          label: 'Profile may slow booking down',
          detail: 'Missing name, email, or phone means Ace may have to stop later for checkout details.',
          tone: 'warning',
        },
    namelessFamily === 0 && missingFlightDob === 0
      ? {
          label: familyMembers.length > 0 ? 'Party details ready' : 'Solo traveller ready',
          detail: familyMembers.length > 0
            ? 'Saved companion basics are in place for this booking request.'
            : 'Ace can move this booking as a solo trip.',
          tone: 'ready',
        }
      : {
          label: 'Passenger details may still be needed',
          detail: missingFlightDob > 0
            ? 'Some travellers still need dates of birth before flight ticketing can finish cleanly.'
            : 'Saved companions should each have a name so Ace can use them reliably by voice.',
          tone: 'warning',
        },
    hasRailLeg && profile?.railcardType && profile.railcardType !== 'none'
      ? {
          label: 'Rail savings in play',
          detail: 'Ace will carry your saved railcard into eligible rail searches and checkout.',
          tone: 'ready',
        }
      : {
          label: hasRailLeg ? 'No rail discount saved' : 'Route preferences loaded',
          detail: hasRailLeg
            ? 'If you hold a railcard, adding it later can improve fares on future trips.'
            : 'Ace is using your saved preferences to keep this journey simple.',
          tone: hasRailLeg ? 'warning' : 'ready',
        },
    fiatAmount > autoConfirmLimitUsdc
      ? {
          label: 'You stay in control of payment',
          detail: 'Ace has the route ready. Face ID or fingerprint is the final go-ahead before money moves.',
          tone: 'ready',
        }
      : {
          label: 'Fast lane is active',
          detail: 'This trip sits within your auto-approve limit, so Ace can move faster once you confirm.',
          tone: 'ready',
        },
  ];
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
    readiness: BookingReadinessItem[];
    /** Total estimated cost across all plan items */
    totalPriceUsdc: number;
    /** Fiat display amount — what the user sees */
    fiatAmount: number;
    fiatSymbol: string;
    fiatCode: string;
  } | null>(null);

  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const prefillFiredRef = useRef(false);

  const scrollRef = useRef<ScrollView>(null);
  const [marketNationality, setMarketNationality] = useState<MarketNationality>('uk');
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [, setCountdownTick] = useState(0);
  const [nearestStation, setNearestStation] = useState<StationGeo | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [confirmFxRate, setConfirmFxRate] = useState<number | null>(null);
  const [usualRoute, setUsualRoute] = useState<{ origin: string; destination: string; count: number; typicalFareGbp?: number } | null>(null);

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
    if (!agentId) throw new Error('Ace is not ready yet. Please restart the app.');

    setTranscript(text);
    const userTurn = { role: 'user' as const, text, ts: Date.now() };
    addTurn(userTurn);
    await appendHistory(userTurn);

    setPhase('thinking');

    // Load travel profile for Phase 1 — preferences only, no identity data.
    // Full profile (legalName, email, phone, documents) is loaded AFTER biometric
    // confirmation in handleBiometricConfirm. This ensures sensitive data never
    // reaches memory before the user explicitly authorises the booking.
    let profile: TravelProfile | null = null;
    let travelProfile: Record<string, unknown> | undefined;
    try {
      if (await hasProfile()) {
        profile = await loadProfileRaw();
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
    if (shouldAutoSpeak({
      narration: response.narration,
      hasPlan: (response.plan?.length ?? 0) > 0,
      needsBiometric: response.needsBiometric,
      phase: 'plan',
    })) {
      await speakIfEnabled(firstSentence(response.narration));
    }

    // Persist detected currency to store (used everywhere in app)
    if (response.currencySymbol && response.currencyCode) {
      setCurrency(response.currencySymbol, response.currencyCode);
    }
    // Cache frequent route for idle suggestion card
    if (response.usualRoute) {
      setUsualRoute(response.usualRoute);
    }

    // If plan needs biometric confirmation, store it
    if (response.needsBiometric && response.plan && response.plan.length > 0) {
      const total      = response.estimatedPriceUsdc ?? 0;
      const fiatAmount = response.fiatAmount          ?? total;
      const fiatSymbol = response.currencySymbol      ?? currencySymbol;
      const fiatCode   = response.currencyCode        ?? currencyCode;
      const readiness  = buildBookingReadiness({
        profile,
        plan: response.plan,
        fiatAmount,
        autoConfirmLimitUsdc,
      });
      // fullProfile is NOT stored here — it will be loaded after biometric in handleBiometricConfirm
      pendingPlanRef.current = {
        transcript: text, plan: response.plan, travelProfile, fullProfile: undefined,
        readiness,
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

  // Auto-fire a pre-filled transcript (e.g. from a disruption rebook notification tap)
  useEffect(() => {
    if (!prefill || prefillFiredRef.current || !agentId) return;
    prefillFiredRef.current = true;
    handleIntent(prefill).catch(() => {});
  }, [prefill, agentId, handleIntent]);

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
      if (shouldAutoSpeak({
        narration: response.narration,
        hasPlan: response.actions.length > 0,
        phase: 'execute',
      })) {
        await speakIfEnabled(firstSentence(response.narration));
      }

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
          passportUrl:     `https://app.agentpay.so/agent/${firstAction.agentId}`,
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
        if (firstAction.journeyId) {
          qs.set('journeyId', firstAction.journeyId);
          qs.set('totalLegs', String(response.actions.length));
        }
        router.push(`/status/${firstAction.jobId}?${qs.toString()}`);
      } else {
        setPhase('idle');
      }
    } catch (e: any) {
      const msg = e.message ?? 'Booking failed. Please try again.';
      setError(msg);
      await speakIfEnabled(`Sorry. ${msg}`);
    }
  }, [agentId, speakIfEnabled]);

  // ── Phase 2: biometric → execute ─────────────────────────────────────────

  const handleBiometricConfirm = useCallback(async () => {
    const pending = pendingPlanRef.current;
    if (!pending) return;

    const authed = await authenticateWithBiometrics('Confirm booking and payment');
    if (!authed) {
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
    addTurn({ role: 'meridian', text: 'OK, cancelled.', ts: Date.now() });
    setPhase('idle');
  }, [speakIfEnabled]);

  // ── UPI pay (India only) ─────────────────────────────────────────────────

  const handleUpiPay = useCallback(async () => {
    await speakIfEnabled('Payment happens after Ace creates the booking request.');
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
      setError('Microphone access denied. Go to Settings → Apps → Ace → Permissions → Microphone.');
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
        setError('Ace took too long — hold to try again.');
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
  const idleSuggestions = personalizedIdleSuggestions({
    market: marketNationality,
    nearestStation: nearestStation?.name ?? null,
    homeStation: homeStation ?? null,
    workStation: workStation ?? null,
  });

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
      <Atmosphere />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <View style={styles.headerDot} />
          <View>
            <Text style={styles.headerTitle}>ACE</Text>
            <Text style={styles.headerSubtitle}>Voice concierge</Text>
          </View>
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
            <View style={styles.heroCard}>
              <View style={styles.heroTopline}>
                <Text style={styles.emptyEyebrow}>Spoken travel concierge</Text>
                <View style={styles.heroToplineRule} />
              </View>
              <Text style={styles.emptyGreeting}>
                {userName !== 'there' ? `${timeGreeting}, ${userName}.` : `${timeGreeting}.`}
              </Text>
              <Text style={styles.heroHeadline}>Travel, handled in one sentence.</Text>
              <Text style={styles.emptyHint}>
                {lastRouteHint
                  ? `${lastRouteHint} Hold the orb and Ace will take it from there.`
                  : nearestStation
                  ? `You are near ${nearestStation.name}. Hold the orb, say the destination, and Ace will line up the best next move.`
                  : `Hold the orb, say where you are going, and Ace will handle the route, booking, and live follow-through.`}
              </Text>
              <View style={styles.heroStatRow}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>Voice first</Text>
                  <Text style={styles.heroStatLabel}>natural requests</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>~5 min</Text>
                  <Text style={styles.heroStatLabel}>concierge booking</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>Live recovery</Text>
                  <Text style={styles.heroStatLabel}>delays and changes</Text>
                </View>
              </View>
            </View>
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
                  {(() => {
                    const statusCopy = activeTripStatusCopy(activeTrip);
                    return (
                      <>
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
                        {statusCopy.pill}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                  </View>
                  <Text style={styles.activeTripTitle} numberOfLines={1}>{activeTrip.title}</Text>
                  <Text style={styles.activeTripMeta} numberOfLines={2}>
                    {statusCopy.body}
                  </Text>
                      </>
                    );
                  })()}
                </Pressable>
              )}
            {usualRoute && (
              <Pressable
                onPress={() => handleIntent(`${usualRoute.origin} to ${usualRoute.destination}`).catch(() => {})}
                style={styles.usualRouteCard}
              >
                <View style={styles.usualRouteRow}>
                  <Ionicons name="repeat-outline" size={14} color="#4ade80" />
                  <Text style={styles.usualRouteLabel}>Your usual</Text>
                  <Text style={styles.usualRouteCount}>{usualRoute.count}×</Text>
                </View>
                <Text style={styles.usualRouteRoute}>{usualRoute.origin} → {usualRoute.destination}</Text>
                {usualRoute.typicalFareGbp != null && (
                  <Text style={styles.usualRouteFare}>~£{usualRoute.typicalFareGbp} · Tap to book</Text>
                )}
              </Pressable>
            )}
            <Pressable onPress={() => router.push('/(main)/trips')} style={styles.myTripsBtn}>
              <Ionicons name="time-outline" size={14} color="#64748b" style={{ marginRight: 6 }} />
              <Text style={styles.myTripsBtnText}>My Trips</Text>
              <Ionicons name="chevron-forward-outline" size={13} color="#334155" style={{ marginLeft: 'auto' }} />
            </Pressable>
            <View style={styles.suggestionsCard}>
              <View style={styles.suggestionsHeader}>
                <Text style={styles.suggestionsEyebrow}>Good first asks</Text>
                <Text style={styles.suggestionsHint}>Keep it natural. Ace hears the destination, infers the route, and suggests the strongest next step.</Text>
              </View>
              <View style={styles.suggestions}>
                {idleSuggestions.map((suggestion) => (
                  <Suggestion
                    key={suggestion}
                    icon={
                      suggestion.toLowerCase().includes('bus') ? 'bus-outline'
                      : suggestion.toLowerCase().includes('metro') ? 'subway-outline'
                      : suggestion.toLowerCase().includes('flight') ? 'airplane-outline'
                      : 'train-outline'
                    }
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
          const adultCount = passengers?.filter((p) => p.relationship !== 'child' && p.relationship !== 'infant').length ?? 1;
          const childCount = passengers?.filter((p) => p.relationship === 'child').length ?? 0;
          const travellerCount = passengers?.length ?? 1;
          const familyRailcardReady = adultCount >= 2 && childCount >= 1 && childCount <= 4
            && plan.some((item) => item.toolName === 'book_train' || item.toolName === 'book_train_india');
          const flightFamilyGaps = tpFam.filter((member) =>
            plan.some((item) => !!item.flightDetails) && member.relationship !== 'infant' && !member.name,
          ).length;
          const planInput = (plan[0]?.input ?? {}) as Record<string, string>;
          const tripOrigin = planInput.origin ?? planInput.from ?? '';
          const tripDest   = planInput.destination ?? planInput.to ?? '';
          const tripContext = (plan[0]?.tripContext ?? null) as TripContext | null;
          const tripDesc   = plan.length > 1
            ? (() => {
                const first = (plan[0]?.input ?? {}) as Record<string, string>;
                const last  = (plan[plan.length - 1]?.input ?? {}) as Record<string, string>;
                const from  = first.origin ?? first.from ?? tripOrigin;
                const to    = last.destination ?? last.to ?? tripDest;
                return from && to ? `${from} → ${to} · ${plan.length} legs` : `${plan.length}-leg journey`;
              })()
            : tripContext?.title ?? (tripOrigin && tripDest ? `${tripOrigin} -> ${tripDest}` : plan[0]?.displayName ?? null); /*
            ? `${tripOrigin} → ${tripDest}`
          */ const finalLegSummary = tripContext?.finalLegSummary ?? plan[0]?.finalLegSummary ?? null;
          const routeData    = tripContext?.routeData    ?? plan[0]?.routeData    ?? null;
          const nearbyPlaces = tripContext?.nearbyPlaces ?? plan[0]?.nearbyPlaces ?? null;
          const cards = tripCards(tripContext).filter((card) => card.kind !== 'destination_suggestion');

          // Flight offer expiry: find the soonest expiry across all flight legs
          const flightExpiresAt = plan
            .map(p => p.flightDetails?.offerExpiresAt)
            .filter(Boolean)
            .sort()[0] ?? null;
          const flightExpiryMins = flightExpiresAt
            ? Math.max(0, Math.floor((new Date(flightExpiresAt).getTime() - Date.now()) / 60000))
            : null;

          const dataSource = plan[0]?.dataSource;
          const sourceLabel = dataSource === 'darwin_live'           ? 'National Rail · Live'
                            : dataSource === 'national_rail_scheduled' ? 'National Rail · Scheduled'
                            : dataSource === 'irctc_live'             ? 'IRCTC · Live'
                            : dataSource === 'eu_live'                ? 'EU Rail · Live'
                            : dataSource === 'eu_scheduled'           ? 'EU Rail · Scheduled'
                            : dataSource === 'global_rail_live'       ? 'Global Rail · Live'
                            : dataSource === 'global_rail_scheduled'  ? 'Global Rail · Scheduled'
                            : dataSource === 'bus_live'               ? 'Coach · Live'
                            : dataSource === 'bus_scheduled'          ? 'Coach · Scheduled'
                            : dataSource === 'estimated'              ? 'Estimated fare'
                            : null;
          const baseGbp = getConfirmBaseGbp(plan);
          const localAmount = baseGbp && confirmFxRate ? baseGbp * confirmFxRate : null;
          const priceLabel = (() => {
            if (code !== 'GBP' && baseGbp) {
              const baseLabel = `£${formatMoneyAmount(baseGbp, 'GBP')}`;
              if (localAmount) {
                return `${baseLabel} · ${sym}${formatMoneyAmount(localAmount, code)}`;
              }
              return baseLabel;
            }
            if (fiat > 0) {
              return `${sym}${formatMoneyAmount(fiat, code)}`;
            }
            return null;
          })();
          // Hotel details — single hotel booking
          const hotelDetails = plan.length === 1 ? plan[0]?.hotelDetails : undefined;
          const hotel = hotelDetails?.bestOption;

          // Multi-leg journey helper
          const isMultiLeg = plan.length > 1;
          const legIcon = (toolName: string) =>
            toolName === 'search_flights' ? '✈️'
            : toolName === 'book_bus'     ? '🚌'
            : toolName === 'plan_metro'   ? '🚇'
            : '🚆';
          const legLabel = (item: typeof plan[0]) => {
            const inp = item.input as Record<string, string>;
            const from = inp.origin ?? inp.from ?? '';
            const to   = inp.destination ?? inp.to ?? '';
            if (item.flightDetails) {
              const dep = item.flightDetails.departureAt?.slice(11, 16) ?? '';
              return `${item.flightDetails.carrier} ${item.flightDetails.flightNumber} · ${dep}  ${from}→${to}`;
            }
            const td = (item as any).trainDetails as { departureTime?: string; operator?: string } | undefined;
            const time = td?.departureTime ?? '';
            const op   = td?.operator ?? item.displayName;
            return `${op}${time ? ` · ${time}` : ''}  ${from}→${to}`;
          };

          return (
            <BlurView intensity={25} tint="dark" style={styles.confirmCard}>
              <View style={styles.confirmEyebrowRow}>
                <Text style={styles.confirmEyebrow}>Ace briefing</Text>
                {sourceLabel && !isMultiLeg && (
                  <View style={styles.sourceBadge}>
                    <Text style={styles.sourceBadgeText}>{sourceLabel}</Text>
                  </View>
                )}
              </View>
              {tripDesc && (
                <Text style={styles.confirmTrip} numberOfLines={2}>{tripDesc}</Text>
              )}

              {travellerCount > 1 && (
                <View style={styles.groupSummaryCard}>
                  <View style={styles.groupSummaryRow}>
                    <Ionicons name="people-outline" size={14} color="#38bdf8" />
                    <Text style={styles.groupSummaryTitle}>
                      {travellerCount} travellers · {adultCount} adult{adultCount === 1 ? '' : 's'}{childCount > 0 ? ` · ${childCount} child${childCount === 1 ? '' : 'ren'}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.groupSummaryBody}>
                    {passengers?.map((p) => p.name).join(', ')}
                  </Text>
                  {familyRailcardReady && (
                    <View style={styles.groupReadyBadge}>
                      <Ionicons name="ticket-outline" size={13} color="#4ade80" />
                      <Text style={styles.groupReadyText}>Family & Friends Railcard should apply on eligible UK rail legs.</Text>
                    </View>
                  )}
                  {flightFamilyGaps > 0 && (
                    <View style={styles.groupWarnBadge}>
                      <Ionicons name="airplane-outline" size={13} color="#f59e0b" />
                      <Text style={styles.groupWarnText}>Some passenger details may still be needed before flight ticketing.</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Multi-leg journey timeline */}
              {isMultiLeg && (
                <View style={styles.legTimeline}>
                  {plan.map((item, idx) => {
                    const itemFiat = code === 'GBP' || !confirmFxRate
                      ? item.estimatedPriceUsdc
                      : item.estimatedPriceUsdc * confirmFxRate;
                    const legFiatStr = itemFiat > 0 ? `${sym}${formatMoneyAmount(itemFiat, code)}` : '';
                    return (
                      <View key={idx} style={styles.legRow}>
                        <View style={styles.legConnector}>
                          <Text style={styles.legIconText}>{legIcon(item.toolName)}</Text>
                          {idx < plan.length - 1 && <View style={styles.legLine} />}
                        </View>
                        <View style={styles.legBody}>
                          <Text style={styles.legLabelText} numberOfLines={1}>{legLabel(item)}</Text>
                          {legFiatStr ? <Text style={styles.legFareText}>{legFiatStr}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                  <View style={styles.legTotalRow}>
                    <Text style={styles.legTotalLabel}>Total</Text>
                    <Text style={styles.legTotalAmount}>{priceLabel ?? ''}</Text>
                  </View>
                </View>
              )}

              {priceLabel && !isMultiLeg && !hotel && (
                <Text style={styles.confirmPrice}>{priceLabel}</Text>
              )}
              {hotel && (
                <View style={styles.hotelCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Text style={{ fontSize: 16 }}>🏨</Text>
                    <Text style={styles.hotelName} numberOfLines={1}>{hotel.name}</Text>
                    <Text style={styles.hotelStars}>{'★'.repeat(Math.min(hotel.stars, 5))}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View>
                      <Text style={styles.hotelDateLabel}>Check-in</Text>
                      <Text style={styles.hotelDate}>{hotelDetails!.checkIn}</Text>
                    </View>
                    <View>
                      <Text style={styles.hotelDateLabel}>Check-out</Text>
                      <Text style={styles.hotelDate}>{hotelDetails!.checkOut}</Text>
                    </View>
                  </View>
                  <Text style={styles.hotelRate}>
                    {hotel.currency} {hotel.ratePerNight}/night · Total {hotel.currency} {hotel.totalCost}
                  </Text>
                  {hotel.area && <Text style={styles.hotelArea}>{hotel.area}</Text>}
                </View>
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
                          {sym}{formatMoneyAmount(personFare, code)}
                          {isChild ? ' (child)' : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
              {flightExpiryMins !== null && flightExpiryMins <= 15 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#431407', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <Ionicons name="time-outline" size={13} color="#fb923c" />
                  <Text style={{ fontSize: 12, color: '#fb923c', flex: 1 }}>
                    {flightExpiryMins <= 0
                      ? 'Price expired. Search again.'
                      : `Price holds for ${flightExpiryMins} more minute${flightExpiryMins === 1 ? '' : 's'} — confirm now.`}
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 11, color: '#6b7280' }}>Service fee </Text>
                <View style={{ backgroundColor: '#052e16', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 11, color: '#4ade80', fontWeight: '600' }}>Included · Beta</Text>
                </View>
              </View>
              <Text style={styles.confirmReason}>
                {isIndia
                  ? 'Best balance of speed, certainty, and payment flow for this trip.'
                  : 'Best balance of timing, fare, and journey simplicity.'}
              </Text>
              <View style={styles.readinessCard}>
                <View style={styles.readinessHeader}>
                  <Ionicons name="shield-checkmark-outline" size={14} color="#38bdf8" />
                  <Text style={styles.readinessTitle}>Ready before Ace books</Text>
                </View>
                {(pendingPlanRef.current?.readiness ?? []).map((item) => (
                  <View key={`${item.label}-${item.detail}`} style={styles.readinessRow}>
                    <Ionicons
                      name={item.tone === 'ready' ? 'checkmark-circle' : 'alert-circle-outline'}
                      size={15}
                      color={item.tone === 'ready' ? '#4ade80' : '#f59e0b'}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.readinessLabel}>{item.label}</Text>
                      <Text style={styles.readinessDetail}>{item.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
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
                  <Text style={styles.confirmText}>Let Ace secure this</Text>
                </LinearGradient>
              </Pressable>
              {isIndia && (
                <View style={styles.upiSection}>
                  <Text style={styles.upiLabel}>India payments happen on the next screen</Text>
                  <Pressable style={styles.upiBtn} onPress={handleUpiPay}>
                    <Ionicons name="qr-code-outline" size={16} color="#f97316" />
                    <Text style={styles.upiBtnText}>Why</Text>
                  </Pressable>
                  <Text style={styles.upiHint}>Ace creates the job first, then collects UPI against that job.</Text>
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

        {(isIdle || isError || phase === 'listening') && (
          <View style={styles.holdPlaque}>
            <View style={styles.holdPlaqueDot} />
            <Text style={styles.holdPlaqueText}>
              {phase === 'listening' ? 'Listening now' : 'Hold Ace to speak'}
            </Text>
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

function Atmosphere() {
  return (
    <View pointerEvents="none" style={styles.atmosphere}>
      <LinearGradient
        colors={['rgba(16, 185, 129, 0.18)', 'rgba(16, 185, 129, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.atmosphereGlowLeft}
      />
      <LinearGradient
        colors={['rgba(56, 189, 248, 0.14)', 'rgba(99, 102, 241, 0.03)', 'rgba(99, 102, 241, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.atmosphereGlowRight}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.atmosphereHairline}
      />
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
  atmosphere: {
    ...StyleSheet.absoluteFillObject,
  },
  atmosphereGlowLeft: {
    position: 'absolute',
    top: -60,
    left: -120,
    width: 320,
    height: 320,
    borderRadius: 180,
  },
  atmosphereGlowRight: {
    position: 'absolute',
    top: 80,
    right: -130,
    width: 360,
    height: 360,
    borderRadius: 200,
  },
  atmosphereHairline: {
    position: 'absolute',
    top: 84,
    left: 24,
    right: 24,
    height: 1,
    opacity: 0.7,
  },

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
    fontSize: 20,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 1.8,
  },
  headerSubtitle: {
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 2,
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

  emptyState:    { paddingTop: 22, paddingBottom: 20 },
  heroCard: {
    backgroundColor: 'rgba(6, 13, 24, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.4)',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 18,
    marginBottom: 18,
    shadowColor: '#020617',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  heroTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  heroToplineRule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.16)',
  },
  emptyEyebrow: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  emptyGreeting: {
    fontSize: 14,
    fontWeight: '600',
    color: '#93c5fd',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  heroHeadline: {
    fontSize: 36,
    fontWeight: '800',
    color: C.textPrimary,
    marginBottom: 12,
    letterSpacing: -1.3,
    lineHeight: 40,
  },
  emptyHint: {
    fontSize: 15,
    color: C.textSecondary,
    marginBottom: 18,
    lineHeight: 24,
    letterSpacing: 0.1,
  },
  heroStatRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  heroStat: {
    flex: 1,
  },
  heroStatValue: {
    fontSize: 13,
    color: '#f8fafc',
    fontWeight: '700',
    marginBottom: 4,
  },
  heroStatLabel: {
    fontSize: 11,
    color: C.textMuted,
    lineHeight: 15,
  },
  heroStatDivider: {
    width: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
  },
  activeTripCard: {
    backgroundColor: 'rgba(8, 18, 32, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.18)',
    borderRadius: 24,
    padding: 18,
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
    backgroundColor: 'rgba(6, 13, 24, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.34)',
    borderRadius: 24,
    padding: 18,
  },
  suggestionsHeader: {
    marginBottom: 10,
  },
  suggestionsEyebrow: {
    fontSize: 11,
    color: '#cbd5e1',
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
  holdPlaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    backgroundColor: 'rgba(6, 13, 24, 0.84)',
  },
  holdPlaqueDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.emBright,
    shadowColor: C.emBright,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  holdPlaqueText: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
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
    borderColor: 'rgba(52, 211, 153, 0.3)',
    borderRadius: 26,
    padding: 24,
    marginBottom: 12,
    alignSelf: 'stretch',
    gap: 14,
    shadowColor: C.em,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 40,
    elevation: 12,
  },
  confirmEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  confirmEyebrow: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  confirmTrip: {
    fontSize: 14,
    color: '#dbeafe',
    textAlign: 'left',
    lineHeight: 21,
    letterSpacing: 0.1,
  },
  sourceBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(8, 18, 32, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.22)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  sourceBadgeText: {
    fontSize: 11,
    color: '#93c5fd',
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
    textAlign: 'left',
    lineHeight: 20,
    marginTop: -6,
  },
  readinessCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.18)',
    backgroundColor: 'rgba(8, 47, 73, 0.28)',
    padding: 12,
    gap: 10,
  },
  readinessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  readinessTitle: {
    fontSize: 12,
    color: '#bae6fd',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  readinessRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  readinessLabel: {
    fontSize: 12,
    color: '#e2e8f0',
    fontWeight: '600',
    marginBottom: 2,
  },
  readinessDetail: {
    fontSize: 11,
    lineHeight: 16,
    color: '#94a3b8',
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
    backgroundColor: 'rgba(3,7,15,0.92)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.16)',
  },
  phaseLabel: {
    fontSize: 11,
    marginBottom: 14,
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

  // Multi-leg journey timeline
  legTimeline:    { marginBottom: 12, borderWidth: 1, borderColor: '#1e293b', borderRadius: 10, padding: 12 },
  legRow:         { flexDirection: 'row', marginBottom: 4 },
  legConnector:   { width: 28, alignItems: 'center' },
  legIconText:    { fontSize: 16, lineHeight: 22 },
  legLine:        { width: 1, flex: 1, backgroundColor: '#1e293b', marginTop: 2, marginBottom: -4, minHeight: 10 },
  legBody:        { flex: 1, paddingLeft: 8, paddingBottom: 10 },
  legLabelText:   { fontSize: 12, color: '#f8fafc', lineHeight: 18 },
  legFareText:    { fontSize: 12, color: '#94a3b8', marginTop: 1 },
  legTotalRow:    { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 8, marginTop: 4 },
  legTotalLabel:  { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  legTotalAmount: { fontSize: 13, color: '#f8fafc', fontWeight: '700' },

  usualRouteCard: {
    backgroundColor: '#061a0e',
    borderWidth: 1,
    borderColor: '#14532d',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
    width: '100%',
  },
  usualRouteRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  usualRouteLabel: { fontSize: 11, color: '#4ade80', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  usualRouteCount: { fontSize: 11, color: '#4ade80', opacity: 0.7, marginLeft: 'auto' as any },
  usualRouteRoute: { fontSize: 16, color: '#f8fafc', fontWeight: '700', marginBottom: 2 },
  usualRouteFare:  { fontSize: 12, color: '#6b7280' },
  hotelCard:       { backgroundColor: '#0a0d14', borderWidth: 1, borderColor: '#1e3a5f', borderRadius: 10, padding: 12, marginBottom: 10, gap: 6 },
  hotelName:       { fontSize: 14, fontWeight: '600', color: '#f8fafc', flex: 1 },
  hotelStars:      { fontSize: 11, color: '#f59e0b', letterSpacing: 1 },
  hotelDateLabel:  { fontSize: 10, color: '#64748b', marginBottom: 2 },
  hotelDate:       { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
  hotelRate:       { fontSize: 12, color: '#4ade80', marginTop: 4 },
  hotelArea:       { fontSize: 11, color: '#64748b' },
  groupSummaryCard:{ backgroundColor: '#081826', borderWidth: 1, borderColor: '#0c4a6e', borderRadius: 12, padding: 12, gap: 8 },
  groupSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupSummaryTitle:{ fontSize: 12, color: '#38bdf8', fontWeight: '700' },
  groupSummaryBody:{ fontSize: 12, color: '#cbd5e1', lineHeight: 18 },
  groupReadyBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#052e16', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#166534' },
  groupReadyText:  { flex: 1, fontSize: 12, color: '#4ade80', lineHeight: 17 },
  groupWarnBadge:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#451a03', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#b45309' },
  groupWarnText:   { flex: 1, fontSize: 12, color: '#fdba74', lineHeight: 17 },
  myTripsBtn:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#1e293b', marginBottom: 10 },
  myTripsBtnText:  { fontSize: 13, color: '#64748b' },
});
