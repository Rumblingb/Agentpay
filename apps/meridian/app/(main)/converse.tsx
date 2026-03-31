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
  TextInput,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C } from '../../lib/theme';

import { AceMark } from '../../components/AceMark';
import { OrbAnimation } from '../../components/OrbAnimation';
import { useStore } from '../../lib/store';
import { startRecording, stopRecording, transcribeAudio } from '../../lib/speech';
import { speakBro, cancelSpeech } from '../../lib/tts';
import { appendHistory, deriveProactiveRouteMemory, loadActiveTrip, loadRouteMemories, saveJourneySession, type ActiveTrip, type RouteMemory } from '../../lib/storage';
import { planIntent, executeIntent, type ConciergePlanItem } from '../../lib/concierge';
import { loadProfileRaw, loadProfileAuthenticated, hasProfile, type TravelProfile } from '../../lib/profile';
import { authenticateWithBiometrics } from '../../lib/biometric';
import { getLocationContext } from '../../lib/location';
import type { StationGeo } from '../../lib/stationGeo';
import { fetchRate } from '../../lib/currency';
import { formatMoneyAmount, isZeroDecimalCurrency } from '../../lib/money';
import type { TripContext } from '../../lib/trip';
import { trackClientEvent } from '../../lib/telemetry';
import { loadPreferredTravelUnit, type TravelUnit } from '../../lib/travelUnits';

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

// ── Main screen ───────────────────────────────────────────────────────────────

const VOICE_ENABLED_KEY = 'bro.voiceEnabled';
const ACE_GUIDANCE_SESSIONS_KEY = 'ace.guidanceSessions';

type BookingReadinessTone = 'ready' | 'warning';

type BookingReadinessItem = {
  label: string;
  detail: string;
  tone: BookingReadinessTone;
};

type SharedTravelReadiness = {
  requiresManualConfirm: boolean;
  readinessItems: BookingReadinessItem[];
};

type BookingMode = 'solo' | 'shared';

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

function narrationStillNeedsAnswer(narration: string): boolean {
  const text = narration.trim().toLowerCase();
  if (!text) return false;
  if (text.includes('?')) return true;
  return [
    'which one',
    'which option',
    'what date',
    'what day',
    'give me the date',
    'tell me the date',
    'which day',
    'what time',
    'tell me the time',
    'give me the time',
    'morning, afternoon or evening',
    'today or tomorrow',
    'want me to',
  ].some((phrase) => text.includes(phrase));
}

function hasExplicitOrigin(text: string): boolean {
  return [
    /\bfrom\b/i,
    /\bdepart(?:ing)? from\b/i,
    /\bleaving from\b/i,
    /\bstarting from\b/i,
    /\bnear me\b/i,
    /\bnear\b/i,
    /\bmy location\b/i,
    /\bcurrent location\b/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeDestinationLedTrip(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || hasExplicitOrigin(normalized)) return false;
  return [
    /\btickets?\s+(to|for)\b/,
    /\b(train|bus|coach|rail)\s+(to|for)\b/,
    /\b(get me|take me|go(?:ing)?|travel(?:ling)?|route|trip)\s+to\b/,
    /\bto\s+[a-z]/,
  ].some((pattern) => pattern.test(normalized));
}

function prepareIntentRequest(params: {
  text: string;
  nearestStation: StationGeo | null;
}): { displayText: string; planningTranscript: string; assumptionNote: string | null } {
  const displayText = params.text.trim();
  if (!displayText || !params.nearestStation || !looksLikeDestinationLedTrip(displayText)) {
    return {
      displayText,
      planningTranscript: displayText,
      assumptionNote: null,
    };
  }

  const stationName = params.nearestStation.name;
  return {
    displayText,
    planningTranscript: `${displayText}

Ace context: the customer is currently nearest to ${stationName}. If they have not given an origin, treat ${stationName} as the likely departure point, recommend the strongest route from there first, explain why in one concise line, and offer to secure it or guide them there first when useful.`,
    assumptionNote: `Using ${stationName} as the likely departure point from your current location. Ace can guide you there first if you want.`,
  };
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

function referencesSharedTravel(text: string): boolean {
  return [
    /\bbook for us\b/i,
    /\bfor us\b/i,
    /\bwe\b/i,
    /\bus\b/i,
    /\bour\b/i,
    /\bmy partner and i\b/i,
    /\bthe family\b/i,
    /\bfor the family\b/i,
    /\bwith the kids\b/i,
    /\bwith my partner\b/i,
  ].some((pattern) => pattern.test(text));
}

function buildSharedTravelUnitContext(unit: TravelUnit): Record<string, unknown> {
  return {
    id: unit.id,
    name: unit.name,
    type: unit.type,
    notes: unit.notes,
    primaryPayerMemberId: unit.primaryPayerMemberId,
    members: unit.members.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      state: member.state,
    })),
  };
}

function buildSharedUnitPrompt(unit: TravelUnit): string {
  if (unit.type === 'couple') return `Book for us`;
  if (unit.type === 'family') return `Book for the family`;
  return `Book for the household`;
}

function buildSharedTravelReadiness(unit: TravelUnit | null): SharedTravelReadiness {
  if (!unit) {
    return { requiresManualConfirm: false, readinessItems: [] };
  }

  const payer = unit.members.find((member) => member.id === unit.primaryPayerMemberId) ?? null;
  const pending = unit.members.filter((member) => member.state === 'pending').length;
  const linked = unit.members.filter((member) => member.state === 'linked').length;
  const requiresManualConfirm =
    pending > 0
    || (!!payer && payer.role !== 'self');

  const readinessItems: BookingReadinessItem[] = [];

  if (linked > 0) {
    readinessItems.push({
      label: 'Shared travellers recognised',
      detail: `${linked} linked traveller${linked === 1 ? '' : 's'} are ready for shared planning.`,
      tone: 'ready',
    });
  }

  if (pending > 0) {
    readinessItems.push({
      label: 'A shared invite is still pending',
      detail: `${pending} traveller${pending === 1 ? '' : 's'} still need to accept the shared link before Ace can treat this like a fully linked household booking.`,
      tone: 'warning',
    });
  } else if (payer && payer.role !== 'self') {
    readinessItems.push({
      label: 'Usual payer is someone else',
      detail: `${payer.name} is marked as the usual payer. Ace will still hold this on your device until shared approvals are live.`,
      tone: 'warning',
    });
  } else {
    readinessItems.push({
      label: 'Shared booking can stay on this device',
      detail: 'Ace can keep the final approval here while still planning for everyone together.',
      tone: 'ready',
    });
  }

  return {
    requiresManualConfirm,
    readinessItems,
  };
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
  sharedTravelUnit?: TravelUnit | null;
}): BookingReadinessItem[] {
  const { profile, plan, fiatAmount, autoConfirmLimitUsdc, sharedTravelUnit } = params;
  const hasRailLeg = plan.some((item) => item.toolName === 'book_train' || item.toolName === 'book_train_india');
  const hasFlightLeg = plan.some((item) => !!item.flightDetails);
  const familyMembers = profile?.familyMembers ?? [];
  const namelessFamily = familyMembers.filter((member) => !member.name?.trim()).length;
  const missingFlightDob = hasFlightLeg
    ? familyMembers.filter((member) => member.relationship !== 'infant' && !member.dateOfBirth).length
    : 0;
  const sharedReadiness = buildSharedTravelReadiness(sharedTravelUnit ?? null);

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
    ...sharedReadiness.readinessItems,
    fiatAmount > autoConfirmLimitUsdc
      ? {
          label: 'You stay in control of payment',
          detail: 'Ace has the route ready. Face ID or fingerprint is the final go-ahead before money moves.',
          tone: 'ready',
        }
      : {
          label: 'Ace can move quickly from here',
          detail: 'This trip is ready to move as soon as you confirm.',
          tone: 'ready',
        },
  ];
}

function buildAssuranceItems(params: {
  plan: ConciergePlanItem[];
  fiatAmount: number;
  hasCards: boolean;
}): string[] {
  const items: string[] = ['Live source checked'];
  if (params.fiatAmount > 0) items.push('Payment stays protected');
  items.push('Monitored until confirmed');
  if (params.hasCards) items.push('Ace support has context');
  return items.slice(0, 3);
}

function buildRecommendationBrief(params: {
  plan: ConciergePlanItem[];
  sourceLabel: string | null;
  familyRailcardReady: boolean;
}): { title: string; why: string; cues: string[] } | null {
  const { plan, sourceLabel, familyRailcardReady } = params;
  if (!plan.length) return null;

  if (plan.length > 1) {
    const first = plan[0]?.input as Record<string, string> | undefined;
    const last = plan[plan.length - 1]?.input as Record<string, string> | undefined;
    const from = first?.origin ?? first?.from ?? 'Origin';
    const to = last?.destination ?? last?.to ?? 'Destination';
    return {
      title: `${from} to ${to}`,
      why: 'Recommended because this is the cleanest end-to-end way to complete the whole journey in one handoff.',
      cues: ['Through-planned', 'Single confirmation', 'Monitored end to end'],
    };
  }

  const item = plan[0];
  const input = item.input as Record<string, string>;
  const from = input.origin ?? input.from ?? '';
  const to = input.destination ?? input.to ?? '';
  const route = from && to ? `${from} to ${to}` : item.displayName;

  if (item.flightDetails) {
    return {
      title: route,
      why: item.flightDetails.stops === 0
        ? 'Recommended because it is the cleanest direct option with workable timing.'
        : 'Recommended because it balances timing and fare better than more awkward connections.',
      cues: [
        item.flightDetails.stops === 0 ? 'Direct' : `${item.flightDetails.stops} stop${item.flightDetails.stops === 1 ? '' : 's'}`,
        item.flightDetails.cabinClass.replace(/_/g, ' '),
        'Live fare',
      ],
    };
  }

  const trainDetails = (item as ConciergePlanItem & {
    trainDetails?: { operator?: string; departureTime?: string };
  }).trainDetails;
  const isEstimated = sourceLabel === 'Estimated fare';
  const why = familyRailcardReady
    ? isEstimated
      ? 'Recommended because it is the clearest route to line up for your group, and Ace will verify the final family fare before securing it.'
      : 'Recommended because it keeps the trip simple and lets Ace check the strongest family fare before it secures the booking.'
    : item.toolName === 'book_bus'
    ? 'Recommended because it is the clearest coach option for this route right now.'
    : isEstimated
    ? 'Recommended because it is the clearest route to line up now, and Ace will verify the live fare before it secures it.'
    : 'Recommended because it is the clearest live route for this journey right now.';

  const cues = [
    trainDetails?.operator ?? item.displayName,
    sourceLabel ?? 'Live checked',
    familyRailcardReady ? 'Railcard ready' : 'Best current fit',
  ].filter(Boolean);

  return {
    title: route,
    why,
    cues: cues.slice(0, 3),
  };
}

function shouldOfferTextFallback(message: string): boolean {
  const copy = message.toLowerCase();
  return (
    copy.includes('voice') ||
    copy.includes('microphone') ||
    copy.includes('hold') ||
    copy.includes('connection') ||
    copy.includes('service') ||
    copy.includes('timed out') ||
    copy.includes('timeout')
  );
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
    assumptionNote?: string | null;
  } | null>(null);

  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const prefillFiredRef = useRef(false);

  const scrollRef = useRef<ScrollView>(null);
  const [marketNationality, setMarketNationality] = useState<MarketNationality>('uk');
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [, setCountdownTick] = useState(0);
  const [nearestStation, setNearestStation] = useState<StationGeo | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [confirmFxRate, setConfirmFxRate] = useState<number | null>(null);
  const [usualRoute, setUsualRoute] = useState<{ origin: string; destination: string; count: number; typicalFareGbp?: number } | null>(null);
  const [routeMemory, setRouteMemory] = useState<RouteMemory | null>(null);
  const [preferredTravelUnit, setPreferredTravelUnit] = useState<TravelUnit | null>(null);
  const [bookingMode, setBookingMode] = useState<BookingMode>('solo');
  const [familyMemberCount, setFamilyMemberCount] = useState(0);
  const [textFallbackVisible, setTextFallbackVisible] = useState(false);
  const [textFallbackDraft, setTextFallbackDraft] = useState('');
  const [confirmRetryNote, setConfirmRetryNote] = useState<string | null>(null);
  const [guidanceSessions, setGuidanceSessions] = useState(0);
  const [travelModePromptDismissed, setTravelModePromptDismissed] = useState(false);

  useEffect(() => {
    if (turns.length === 0) return;
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [turns]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const profile = await loadProfileRaw();
        if (!active) return;
        if (profile?.nationality) setMarketNationality(profile.nationality);
        setFamilyMemberCount(profile?.familyMembers?.length ?? 0);
      } catch {
        // Keep the default UK launch market if the profile is unavailable.
        if (active) setFamilyMemberCount(0);
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
      const sharedUnit = await loadPreferredTravelUnit().catch(() => null);
      const memories = await loadRouteMemories().catch(() => []);
      if (active) {
        setPreferredTravelUnit(sharedUnit);
        setBookingMode(sharedUnit ? 'shared' : 'solo');
        setTravelModePromptDismissed(false);
        setRouteMemory(deriveProactiveRouteMemory(memories));
      }
    })();
    return () => {
      active = false;
    };
  }, []));


  // Detect nearest station on mount (fire-and-forget, best-effort)
  useEffect(() => {
    let active = true;
    getLocationContext().then((context) => {
      if (active) {
        setNearestStation(context.nearestStation);
        setLocationLabel(context.placeLabel);
      }
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
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ACE_GUIDANCE_SESSIONS_KEY);
        const current = Number(raw ?? '0');
        const next = Number.isFinite(current) ? current + 1 : 1;
        if (active) setGuidanceSessions(next);
        await AsyncStorage.setItem(ACE_GUIDANCE_SESSIONS_KEY, String(next));
      } catch {
        if (active) setGuidanceSessions(1);
      }
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

  const openTextFallback = useCallback((message: string, seed?: string) => {
    setError(message);
    setTextFallbackVisible(true);
    if (seed != null) {
      setTextFallbackDraft(seed);
    }
  }, [setError]);

  // ── Phase 1: plan ─────────────────────────────────────────────────────────

  const handleIntent = useCallback(async (text: string) => {
    if (!agentId) throw new Error('Ace is not ready yet. Please restart the app.');

    const prepared = prepareIntentRequest({ text, nearestStation });
    const displayText = prepared.displayText;

    setTextFallbackVisible(false);
    setTextFallbackDraft('');
    setConfirmRetryNote(null);
    setTranscript(displayText);
    setPhase('thinking');

    // Load travel profile for Phase 1 — preferences only, no identity data.
    // Full profile (legalName, email, phone, documents) is loaded AFTER biometric
    // confirmation in handleBiometricConfirm. This ensures sensitive data never
    // reaches memory before the user explicitly authorises the booking.
    let profile: TravelProfile | null = null;
    let travelProfile: Record<string, unknown> | undefined;
    const usingSharedTravel = !!preferredTravelUnit && (bookingMode === 'shared' || referencesSharedTravel(displayText));
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
          if (usingSharedTravel && preferredTravelUnit) {
            travelProfile.sharedTravelUnit = buildSharedTravelUnitContext(preferredTravelUnit);
          }
        }
      }
    } catch {
      // No profile stored — proceed without
    }

    if (!travelProfile && usingSharedTravel && preferredTravelUnit) {
      travelProfile = {
        sharedTravelUnit: buildSharedTravelUnitContext(preferredTravelUnit),
      };
    }

    // Phase 1: get a plan from Claude — no hire fires yet
    const response = await planIntent({
      transcript:   prepared.planningTranscript,
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

    const waitingForFollowUp = narrationStillNeedsAnswer(response.narration);

    // If plan needs biometric confirmation, store it only when Ace is no longer asking a follow-up.
    if (response.needsBiometric && response.plan && response.plan.length > 0 && !waitingForFollowUp) {
      const total      = response.estimatedPriceUsdc ?? 0;
      const fiatAmount = response.fiatAmount          ?? total;
      const fiatSymbol = response.currencySymbol      ?? currencySymbol;
      const fiatCode   = response.currencyCode        ?? currencyCode;
      const readiness  = buildBookingReadiness({
        profile,
        plan: response.plan,
        fiatAmount,
        autoConfirmLimitUsdc,
        sharedTravelUnit: usingSharedTravel && preferredTravelUnit ? preferredTravelUnit : null,
      });
      const sharedReadiness = buildSharedTravelReadiness(usingSharedTravel && preferredTravelUnit ? preferredTravelUnit : null);
      // fullProfile is NOT stored here — it will be loaded after biometric in handleBiometricConfirm
      pendingPlanRef.current = {
        transcript: prepared.planningTranscript, plan: response.plan, travelProfile, fullProfile: undefined,
        readiness,
        totalPriceUsdc: total, fiatAmount, fiatSymbol, fiatCode,
        assumptionNote: prepared.assumptionNote,
      };

      // Auto-confirm if total is within the spending limit (no fingerprint needed)
      if (total > 0 && total <= autoConfirmLimitUsdc && !sharedReadiness.requiresManualConfirm) {
        await executePhase2(pendingPlanRef.current);
        return;
      }

      // Above limit — show confirmation card with price + fingerprint gate
      setConfirmRetryNote(null);
      setPhase('confirming');
      return;
    }

    // No action needed yet (research, clarification, or error from Claude)
    pendingPlanRef.current = null;
    setPhase('idle');
  }, [agentId, autoConfirmLimitUsdc, bookingMode, nearestStation, preferredTravelUnit, speakIfEnabled]);

  const runIntentWithUiFallback = useCallback(async (text: string) => {
    try {
      await handleIntent(text);
    } catch (e: any) {
      const msg = e?.message ?? 'Ace could not line that route up. Please try again.';
      setError(msg);
      setPhase('error');
      await speakIfEnabled(`Sorry. ${msg}`);
    }
  }, [handleIntent, setError, setPhase, speakIfEnabled]);

  // Auto-fire a pre-filled transcript (e.g. from a disruption rebook notification tap)
  useEffect(() => {
    if (!prefill || prefillFiredRef.current || !agentId) return;
    prefillFiredRef.current = true;
    void runIntentWithUiFallback(prefill);
  }, [prefill, agentId, runIntentWithUiFallback]);

  const handleTextFallbackSend = useCallback(async () => {
    const text = textFallbackDraft.trim();
    if (!text) return;
    setTextFallbackVisible(false);
    setTextFallbackDraft('');
    setConfirmRetryNote(null);
    setError(null);
    await handleIntent(text);
  }, [handleIntent, setError, textFallbackDraft]);

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
          category: firstAction.toolName,
          description: firstAction.displayName,
          pricePerTaskUsd: firstAction.agreedPriceUsdc,
          capabilities: [],
          trustScore: 0,
          grade: 'B',
          verified: true,
          passportUrl: `https://app.agentpay.so/agent/${firstAction.agentId}`,
        });
        setPhase('done');
        const fiat   = pending.fiatAmount;
        const sym    = pending.fiatSymbol;
        const code   = pending.fiatCode;
        const routeTitle =
          (firstAction.tripContext?.title
          ?? [
            (firstAction.input as Record<string, string> | undefined)?.origin ?? null,
            (firstAction.input as Record<string, string> | undefined)?.destination ?? null,
          ].filter(Boolean).join(' -> '))
          || firstAction.displayName;
        const liveIntentId = firstAction.jobId;
        await saveJourneySession({
          intentId: liveIntentId,
          jobId: firstAction.jobId,
          journeyId: firstAction.journeyId ?? null,
          title: routeTitle,
          state: 'securing',
          bookingState: firstAction.tripContext?.watchState?.bookingState ?? 'securing',
          fromStation: (firstAction.input as Record<string, string> | undefined)?.origin ?? firstAction.tripContext?.origin ?? null,
          toStation: (firstAction.input as Record<string, string> | undefined)?.destination ?? firstAction.tripContext?.destination ?? null,
          departureTime: firstAction.tripContext?.departureTime ?? null,
          departureDatetime: firstAction.tripContext?.departureTime ?? null,
          arrivalTime: firstAction.tripContext?.arrivalTime ?? null,
          platform: null,
          operator: firstAction.tripContext?.operator ?? null,
          bookingRef: firstAction.tripContext?.bookingRef ?? null,
          finalLegSummary: firstAction.tripContext?.finalLegSummary ?? null,
          fiatAmount: fiat,
          currencySymbol: sym,
          currencyCode: code,
          tripContext: firstAction.tripContext ?? null,
          shareToken: (firstAction as any).shareToken ?? null,
          updatedAt: new Date().toISOString(),
        });
        router.push({ pathname: '/(main)/journey/[intentId]', params: { intentId: liveIntentId } });
      } else {
        setError(response.narration);
        setPhase('error');
      }
    } catch (e: any) {
      const msg = e.message ?? 'Booking failed. Please try again.';
      setError(msg);
      setConfirmRetryNote(null);
      await speakIfEnabled(`Sorry. ${msg}`);
    }
  }, [agentId, setCurrentAgent, speakIfEnabled]);

  // ── Phase 2: biometric → execute ─────────────────────────────────────────

  const handleBiometricConfirm = useCallback(async () => {
    const pending = pendingPlanRef.current;
    if (!pending) return;

    const authed = await authenticateWithBiometrics('Confirm booking and payment');
    if (!authed) {
      const retryMsg = 'Confirmation was not completed. You can try again when you are ready.';
      setConfirmRetryNote(retryMsg);
      addTurn({ role: 'meridian', text: retryMsg, ts: Date.now() });
      return;
    }

    setConfirmRetryNote(null);

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
    setConfirmRetryNote(null);
    addTurn({ role: 'meridian', text: 'OK, cancelled.', ts: Date.now() });
    setPhase('idle');
  }, []);

  // ── UPI pay (India only) ─────────────────────────────────────────────────


  // ── Hold-to-talk (press = start recording, release = send) ──────────────
  // Minimum hold: 600ms. Shorter = accidental tap, reset silently.
  // recordingReadyRef guards the race where user releases before startRecording() completes.

  const recordingActiveRef = useRef(false);
  const finishingRecordingRef = useRef(false);

  const finishVoiceCapture = useCallback(async () => {
    if (finishingRecordingRef.current) return;
    finishingRecordingRef.current = true;
    setPhase('thinking');

    try {
      const uri = await stopRecording();
      recordingActiveRef.current = false;
      if (!uri) { setPhase('idle'); return; }

      let text = '';
      try {
        text = await transcribeAudio(uri);
      } catch (e: any) {
        const msg = (e.message ?? '').toLowerCase();
        const rawMessage = e.message ?? 'Voice transcription failed.';
        console.error('[bro/stt]', rawMessage);
        void trackClientEvent({
          event: 'stt_transcription_failed',
          screen: 'converse',
          severity: 'warning',
          message: rawMessage,
          metadata: { phase: 'transcribe' },
        });
        let nextMessage = __DEV__ ? `STT: ${rawMessage}` : 'Voice error — try again.';
        if (!__DEV__) {
          nextMessage = 'Ace missed that. Say it again, or type the trip below.';
        }
        if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('abort')) {
          nextMessage = 'Ace did not catch that in time. Say it again, or type it below.';
        } else if (msg.includes('401') || msg.includes('403') || msg.includes('not authorised')) {
          nextMessage = 'Voice service is unavailable right now. You can type the trip below.';
        } else if (msg.includes('503') || msg.includes('not configured')) {
          nextMessage = 'Voice service is offline for the moment. You can type the trip below.';
        } else if (msg.includes('empty') || msg.includes('missing') || msg.includes('hold')) {
          nextMessage = 'Ace did not catch enough of that. Try again in your own words, or type it below.';
        } else if (msg.includes('network error') || msg.includes('network request') || msg.includes('unreachable')) {
          nextMessage = 'Ace cannot reach voice right now. You can type the trip below.';
        } else if (msg.includes('502') || msg.includes('transcription error') || msg.includes('whisper')) {
          nextMessage = 'Voice service had trouble with that request. You can type the trip below.';
        }
        if (shouldOfferTextFallback(nextMessage)) {
          openTextFallback(nextMessage);
        } else {
          setError(nextMessage);
        }
        return;
      }

      if (!text.trim()) {
        const message = 'Ace did not catch that clearly. Try again, spell it out, or type the trip below.';
        openTextFallback(message);
        void trackClientEvent({
          event: 'stt_empty_transcript',
          screen: 'converse',
          severity: 'warning',
          message,
        });
        return;
      }

      await handleIntent(text);
    } catch (e: any) {
      recordingActiveRef.current = false;
      const msg = (e.message ?? '').toLowerCase();
      const rawMessage = e.message ?? 'Voice capture failed.';
      void trackClientEvent({
        event: 'voice_capture_failed',
        screen: 'converse',
        severity: 'warning',
        message: rawMessage,
        metadata: { phase: 'capture' },
      });
      let nextMessage = 'Something went wrong — tap to try again.';
      nextMessage = 'Ace missed that. Touch and say it again, or type the trip below.';
      if (msg.includes('timed out') || msg.includes('timeout')) {
        nextMessage = 'Ace took too long on that request. Try again, or type it below.';
      } else if (msg.includes('no connection') || msg.includes('internet') || msg.includes('network')) {
        nextMessage = 'Ace cannot reach the network right now. You can type the trip below.';
      } else if (msg.includes('offline')) {
        nextMessage = 'Service is offline right now. You can type the trip below.';
      }
      if (shouldOfferTextFallback(nextMessage)) {
        openTextFallback(nextMessage);
      } else {
        setError(nextMessage);
      }
    } finally {
      finishingRecordingRef.current = false;
    }
  }, [handleIntent, openTextFallback, setError]);

  const beginVoiceCapture = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'error') return;
    cancelSpeech();
    if (phase === 'error') reset();
    setTextFallbackVisible(false);
    setError(null);
    setPhase('listening');
    try {
      await startRecording({
        autoStopOnSilence: true,
        silenceMs: 2200,
        maxDurationMs: 12000,
        onSilence: () => {
          void finishVoiceCapture();
        },
      });
      recordingActiveRef.current = true;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      recordingActiveRef.current = false;
      const message = 'Microphone access denied. You can enable it in Settings, or type the trip instead.';
      setError(message);
      setTextFallbackVisible(true);
      void trackClientEvent({
        event: 'voice_permission_denied',
        screen: 'converse',
        severity: 'warning',
        message,
      });
    }
  }, [finishVoiceCapture, phase, reset, setError]);

  const handleOrbTap = useCallback(async () => {
    if (phase === 'listening') {
      await finishVoiceCapture();
      return;
    }
    await beginVoiceCapture();
  }, [beginVoiceCapture, finishVoiceCapture, phase]);

  const handleShortcutIntent = useCallback(async (destination: string, kind: 'home' | 'work') => {
    if (!nearestStation) return;
    const text =
      kind === 'home'
        ? `Get me home from ${nearestStation.name} to ${destination}`
        : `Get to work from ${nearestStation.name} to ${destination}`;
    await handleIntent(text);
  }, [handleIntent, nearestStation]);

  // ── Render ────────────────────────────────────────────────────────────────

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

  const lastRouteHintPreview = activeTrip?.fromStation && activeTrip?.toStation && activeTrip.status === 'ticketed'
    ? `${activeTrip.fromStation} → ${activeTrip.toStation} again?`
    : null;

  const heroExample = bookingMode === 'shared'
    ? 'Ace, get us to Glasgow tomorrow.'
    : lastRouteHintPreview
    ? `Ace, ${lastRouteHintPreview.replace(/\?$/, '')}.`
    : nearestStation
    ? `Ace, get me from ${nearestStation.name} tomorrow morning.`
    : 'Ace, get me to Glasgow tomorrow.';

  const heroResponse = bookingMode === 'shared'
    ? `I'll line this up for ${preferredTravelUnit?.name?.toLowerCase() ?? 'both of you'}.`
    : 'I’ll line up the best way there.';
  const primarySuggestion = idleSuggestions[0] ?? null;
  const showIdleGuidance = guidanceSessions > 0 && guidanceSessions <= 3;
  const memorySuggestion = routeMemory
    ? `${routeMemory.origin} to ${routeMemory.destination}`
    : null;
  const memoryBody = routeMemory
    ? routeMemory.count >= 3
      ? `Ace has seen this route ${routeMemory.count} times and can line it up before you ask.`
      : `Ace remembers this route and can line it up quickly when you need it.`
    : null;
  const shouldShowTravelModeReminder = guidanceSessions >= 3 && guidanceSessions % 6 === 0;
  const shouldNudgeTravelSetup =
    !preferredTravelUnit
    && !travelModePromptDismissed
    && guidanceSessions >= 2
    && guidanceSessions % 4 === 0;
  const inferredTravelShape =
    familyMemberCount >= 2 ? 'family'
    : familyMemberCount === 1 ? 'couple'
    : 'single';
  const travelModeReminder = preferredTravelUnit
    ? shouldShowTravelModeReminder
    ? {
        eyebrow: 'Travel mode',
        title: `Ace is set to ${preferredTravelUnit.type}.`,
        body: `${preferredTravelUnit.name} is your current shared travel unit, so Ace can think in terms of us when you need it to.`,
        primaryLabel: 'Manage travel mode',
        primaryAction: () => router.push('/(main)/travel-together'),
        secondaryLabel: null as string | null,
        secondaryAction: null as (() => void) | null,
      }
    : null
    : shouldNudgeTravelSetup
    ? inferredTravelShape === 'family'
      ? {
          eyebrow: 'Travel mode',
          title: 'Ace still sees this as solo travel.',
          body: 'You already have family details saved. Want Ace to set up family mode quietly in the background so “for the family” just works?',
          primaryLabel: 'Set up family mode',
          primaryAction: () => router.push('/(main)/travel-together'),
          secondaryLabel: 'Later',
          secondaryAction: () => setTravelModePromptDismissed(true),
        }
      : inferredTravelShape === 'couple'
      ? {
          eyebrow: 'Travel mode',
          title: 'Ace is still treating you as solo.',
          body: 'If you usually travel as a couple, Ace can help set that up in the background so “for us” becomes natural.',
          primaryLabel: 'Set up couple mode',
          primaryAction: () => router.push('/(main)/travel-together'),
          secondaryLabel: 'Later',
          secondaryAction: () => setTravelModePromptDismissed(true),
        }
      : {
          eyebrow: 'Travel mode',
          title: 'Ace is keeping this personal to you.',
          body: 'If that changes, Ace can set up couple or family travel in the background without interrupting how you book today.',
          primaryLabel: 'Set up travel mode',
          primaryAction: () => router.push('/(main)/travel-together'),
          secondaryLabel: 'Keep solo',
          secondaryAction: () => setTravelModePromptDismissed(true),
        }
    : null;

  // Last route suggestion — "Same route as last time?"
  const lastRouteHint = activeTrip?.fromStation && activeTrip?.toStation && activeTrip.status === 'ticketed'
    ? `${activeTrip.fromStation} → ${activeTrip.toStation} again?`
    : null;
  const recentTurns = turns.filter((turn) => turn.role === 'meridian').slice(-4);
  return (
    <SafeAreaView style={styles.safe}>
      <Atmosphere />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <View style={styles.headerMarkWrap}>
            <AceMark size={26} />
          </View>
          <View>
            <Text style={styles.headerTitle}>ACE</Text>
            <Text style={styles.headerSubtitle}>Travel, handled</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {locationLabel && (
            <View style={styles.nearBadge}>
              <Text style={styles.nearBadgeText}>{locationLabel}</Text>
            </View>
          )}
          <Pressable onPress={() => router.push('/settings')} hitSlop={12} style={styles.headerIconBtn}>
            <Ionicons name="settings-outline" size={19} color={C.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* Conversation */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, isConfirming && styles.scrollContentConfirming]}
        showsVerticalScrollIndicator={false}
      >
        {turns.length === 0 && isIdle && (
          <View style={styles.emptyState}>
            <View style={styles.heroCard}>
              <Text style={styles.emptyGreeting}>
                {userName !== 'there' ? `${timeGreeting}, ${userName}.` : `${timeGreeting}.`}
              </Text>
              <AceMark size={94} />
              <Text style={styles.heroExample}>{heroExample}</Text>
              <Text style={styles.heroResponse}>{heroResponse}</Text>
              {preferredTravelUnit && (
                <View style={styles.modeCard}>
                  <View style={styles.modeHeader}>
                    <Text style={styles.modeEyebrow}>Who is travelling?</Text>
                  </View>
                  <View style={styles.modeRow}>
                    <Pressable
                      onPress={() => setBookingMode('solo')}
                      style={[styles.modeBtn, bookingMode === 'solo' && styles.modeBtnActive]}
                    >
                      <Ionicons
                        name={bookingMode === 'solo' ? 'person' : 'person-outline'}
                        size={15}
                        color={bookingMode === 'solo' ? '#f8fafc' : '#94a3b8'}
                      />
                      <Text style={[styles.modeBtnText, bookingMode === 'solo' && styles.modeBtnTextActive]}>Just me</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setBookingMode('shared')}
                      style={[styles.modeBtn, bookingMode === 'shared' && styles.modeBtnSharedActive]}
                    >
                      <Ionicons
                        name={bookingMode === 'shared' ? 'people' : 'people-outline'}
                        size={15}
                        color={bookingMode === 'shared' ? '#faf5ff' : '#d8b4fe'}
                      />
                      <Text style={[styles.modeBtnText, bookingMode === 'shared' && styles.modeBtnTextShared]}>
                        {preferredTravelUnit.name}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={styles.modeFootnote}>
                    {bookingMode === 'shared'
                      ? 'Ace will hold this as one shared trip.'
                      : 'Ace will keep this trip just for you.'}
                  </Text>
                </View>
              )}
            </View>
              {activeTrip && (
                <Pressable
                onPress={() => {
                  router.push({
                    pathname: '/(main)/journey/[intentId]',
                    params: { intentId: activeTrip.intentId },
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
                onPress={() => { void runIntentWithUiFallback(`${usualRoute.origin} to ${usualRoute.destination}`); }}
                style={styles.usualRouteCard}
              >
                <View style={styles.usualRouteRow}>
                  <Ionicons name="repeat-outline" size={14} color="#cbe8ff" />
                  <Text style={styles.usualRouteLabel}>Your usual</Text>
                  <Text style={styles.usualRouteCount}>{usualRoute.count}×</Text>
                </View>
                <Text style={styles.usualRouteRoute}>{usualRoute.origin} → {usualRoute.destination}</Text>
                {usualRoute.typicalFareGbp != null && (
                  <Text style={styles.usualRouteFare}>~£{usualRoute.typicalFareGbp} · Tap to book</Text>
                )}
              </Pressable>
            )}
            {!usualRoute && routeMemory && memorySuggestion && (
              <Pressable
                onPress={() => { void runIntentWithUiFallback(memorySuggestion); }}
                style={styles.usualRouteCard}
              >
                <View style={styles.usualRouteRow}>
                  <Ionicons name="sparkles-outline" size={14} color="#cbe8ff" />
                  <Text style={styles.usualRouteLabel}>Ace remembered</Text>
                  <Text style={styles.usualRouteCount}>{routeMemory.count}×</Text>
                </View>
                <Text style={styles.usualRouteRoute}>{routeMemory.origin} → {routeMemory.destination}</Text>
                {memoryBody && (
                  <Text style={styles.usualRouteFare}>{memoryBody}</Text>
                )}
              </Pressable>
            )}
            {preferredTravelUnit && (
              <View style={styles.sharedUnitCard}>
                <View style={styles.sharedUnitHeader}>
                  <Ionicons name="people-circle-outline" size={16} color="#cbe8ff" />
                  <Text style={styles.sharedUnitLabel}>{preferredTravelUnit.name}</Text>
                  <Text style={styles.sharedUnitMeta}>
                    {preferredTravelUnit.type === 'couple' ? 'Couple' : preferredTravelUnit.type === 'family' ? 'Family' : 'Household'}
                  </Text>
                </View>
                <Text style={styles.sharedUnitBody}>
                  Ace can plan around this shared unit when you say `for us`, `for the family`, or ask it to get everyone moving together.
                </Text>
                <View style={styles.sharedUnitActions}>
                  <Pressable
                    onPress={() => { void runIntentWithUiFallback(buildSharedUnitPrompt(preferredTravelUnit)); }}
                    style={styles.sharedUnitBtn}
                  >
                    <Text style={styles.sharedUnitBtnText}>{buildSharedUnitPrompt(preferredTravelUnit)}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { void runIntentWithUiFallback('Get us home'); }}
                    style={[styles.sharedUnitBtn, styles.sharedUnitBtnSecondary]}
                  >
                    <Text style={[styles.sharedUnitBtnText, styles.sharedUnitBtnTextSecondary]}>Get us home</Text>
                  </Pressable>
                </View>
              </View>
            )}
            {travelModeReminder && (
              <View style={styles.travelModePromptCard}>
                <View style={styles.travelModePromptHeader}>
                  <Text style={styles.travelModePromptEyebrow}>{travelModeReminder.eyebrow}</Text>
                </View>
                <Text style={styles.travelModePromptTitle}>{travelModeReminder.title}</Text>
                <Text style={styles.travelModePromptBody}>{travelModeReminder.body}</Text>
                <View style={styles.travelModePromptActions}>
                  <Pressable
                    onPress={travelModeReminder.primaryAction}
                    style={styles.travelModePromptPrimary}
                  >
                    <Text style={styles.travelModePromptPrimaryText}>{travelModeReminder.primaryLabel}</Text>
                  </Pressable>
                  {travelModeReminder.secondaryLabel && travelModeReminder.secondaryAction && (
                    <Pressable
                      onPress={travelModeReminder.secondaryAction}
                      style={styles.travelModePromptSecondary}
                    >
                      <Text style={styles.travelModePromptSecondaryText}>{travelModeReminder.secondaryLabel}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
            <Pressable onPress={() => router.push('/(main)/trips')} style={styles.myTripsBtn}>
              <Ionicons name="time-outline" size={14} color="#64748b" style={{ marginRight: 6 }} />
              <Text style={styles.myTripsBtnText}>Journeys</Text>
              <Ionicons name="chevron-forward-outline" size={13} color="#334155" style={{ marginLeft: 'auto' }} />
            </Pressable>
            {primarySuggestion && (
              <View style={styles.suggestionsCard}>
                <View style={styles.suggestionsHeader}>
                  <Text style={styles.suggestionsEyebrow}>Try this</Text>
                </View>
                <View style={styles.suggestions}>
                  <Suggestion
                    icon={
                      primarySuggestion.toLowerCase().includes('bus') ? 'bus-outline'
                      : primarySuggestion.toLowerCase().includes('metro') ? 'subway-outline'
                      : primarySuggestion.toLowerCase().includes('flight') ? 'airplane-outline'
                      : 'train-outline'
                    }
                    text={primarySuggestion}
                    onPress={() => { void runIntentWithUiFallback(primarySuggestion); }}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {recentTurns.length > 0 && (
          <View style={styles.recentTurnsCard}>
            <View style={styles.recentTurnsHeader}>
              <Text style={styles.recentTurnsEyebrow}>Ace is thinking</Text>
              {recentTurns.length > 1 && (
                <Text style={styles.recentTurnsCount}>Last {recentTurns.length}</Text>
              )}
            </View>
            {recentTurns.map((turn, i) => (
              <View
                key={`${turn.ts}-${i}`}
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
          </View>
        )}

        {isConfirming && (() => {
          const fiat    = pendingPlanRef.current?.fiatAmount ?? 0;
          const sym     = pendingPlanRef.current?.fiatSymbol ?? currencySymbol;
          const code    = pendingPlanRef.current?.fiatCode ?? currencyCode;
          const plan    = pendingPlanRef.current?.plan ?? [];
          // Family members from Phase 1 profile (non-sensitive — names + relationships only)
          const tpFam   = (pendingPlanRef.current?.travelProfile?.familyMembers as Array<{ name: string; relationship: string; railcard?: string }> | undefined) ?? [];
          const sharedMembers = ((pendingPlanRef.current?.travelProfile?.sharedTravelUnit as {
            members?: Array<{ name: string; role: 'self' | 'partner' | 'adult' | 'child' | 'infant' }>;
          } | undefined)?.members ?? [])
            .filter((member) => member.name?.trim())
            .map((member) => ({
              name: member.role === 'self' ? 'You' : member.name,
              relationship: member.role === 'child' || member.role === 'infant' ? member.role : 'adult' as const,
            }));
          const passengers = sharedMembers.length > 0
            ? sharedMembers
            : tpFam.length > 0
              ? [{ name: 'You', relationship: 'adult' as const }, ...tpFam]
              : null;
          const adultCount = passengers?.filter((p) => p.relationship !== 'child' && p.relationship !== 'infant').length ?? 1;
          const childCount = passengers?.filter((p) => p.relationship === 'child').length ?? 0;
          const travellerCount = passengers?.length ?? 1;
          const familyRailcardReady = adultCount >= 2 && childCount >= 1 && childCount <= 4
            && plan.some((item) => item.toolName === 'book_train' || item.toolName === 'book_train_india');
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
          const companionSummary = travellerCount > 1
            ? `${travellerCount} travellers${childCount > 0 ? `, including ${childCount} child${childCount === 1 ? '' : 'ren'}` : ''}`
            : null;
          const hotel = plan.length === 1 ? plan[0]?.hotelDetails?.bestOption : undefined;
          const isMultiLeg = plan.length > 1;
          const itinerarySummary = isMultiLeg
            ? `${plan.length} legs, secured as one continuous journey.`
            : hotel
            ? `${hotel.name}${hotel.area ? `, ${hotel.area}` : ''}`
            : finalLegSummary;
          const confirmMeta = [itinerarySummary, sourceLabel, companionSummary].filter(Boolean).join(' | ');
          const decisionLine = isIndia
            ? 'Ace has the route. You just need to say yes before UPI opens.'
            : 'Ace has the route. You just need to say yes.';
          const paymentSummary = isIndia
            ? 'UPI opens right after you approve.'
            : 'Face ID is the final approval before money moves.';
          // Hotel details — single hotel booking
          return (
            <View style={styles.confirmCard}>
              <Text style={styles.confirmEyebrow}>Ready when you are</Text>
              {tripDesc && (
                <Text style={styles.confirmTrip} numberOfLines={2}>{tripDesc}</Text>
              )}
              {confirmMeta ? (
                <Text style={styles.confirmMeta}>{confirmMeta}</Text>
              ) : null}
              {priceLabel && (
                <Text style={styles.confirmPrice}>{sourceLabel === 'Estimated fare' ? `From ${priceLabel}` : priceLabel}</Text>
              )}
              <Text style={styles.confirmDecision}>{decisionLine}</Text>
              {pendingPlanRef.current?.assumptionNote && (
                <Text style={styles.confirmFootnote}>{pendingPlanRef.current.assumptionNote}</Text>
              )}
              {flightExpiryMins !== null && flightExpiryMins <= 15 && (
                <View style={styles.confirmRetryCard}>
                  <Ionicons name="time-outline" size={14} color="#e5c995" />
                  <Text style={styles.confirmRetryText}>
                    {flightExpiryMins <= 0
                      ? 'This fare has just expired. Search again before you approve.'
                      : `This fare holds for ${flightExpiryMins} more minute${flightExpiryMins === 1 ? '' : 's'}.`}
                  </Text>
                </View>
              )}
              {confirmRetryNote && (
                <View style={styles.confirmRetryCard}>
                  <Ionicons name="refresh-outline" size={14} color="#e5c995" />
                  <Text style={styles.confirmRetryText}>{confirmRetryNote}</Text>
                </View>
              )}
              <Text style={styles.confirmSecurityLine}>{paymentSummary}</Text>
              <Pressable style={styles.confirmBtn} onPress={handleBiometricConfirm}>
                <LinearGradient
                  colors={['#13263b', '#274665']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.confirmBtnGrad}
                >
                  <Ionicons name="finger-print-outline" size={20} color="#edf6ff" />
                  <Text style={styles.confirmText}>Approve with Face ID</Text>
                </LinearGradient>
              </Pressable>
              <Pressable style={styles.confirmCancel} onPress={handleCancelConfirm}>
                <Text style={styles.confirmCancelText}>Not now</Text>
              </Pressable>
            </View>
          );
        })()}

        {isError && error && (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={16} color="#f87171" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={{ height: isConfirming ? 48 : 260 }} />
      </ScrollView>

      {/* Orb + label */}
      {!isConfirming && (
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

        {(phase === 'listening' || ((isIdle || isError) && showIdleGuidance)) && (
          <View style={styles.holdPlaque}>
            <View style={styles.holdPlaqueDot} />
            <Text style={styles.holdPlaqueText}>
              {phase === 'listening' ? 'Listening — pause when you are done' : 'Touch Ace and speak naturally'}
            </Text>
          </View>
        )}

        {textFallbackVisible && (
          <View style={styles.textFallbackCard}>
            <View style={styles.textFallbackHeader}>
              <Ionicons name="create-outline" size={14} color="#cbe8ff" />
              <Text style={styles.textFallbackTitle}>Type the trip instead</Text>
            </View>
            <Text style={styles.textFallbackBody}>
              Keep it short. Ace will still handle the rest.
            </Text>
            <TextInput
              value={textFallbackDraft}
              onChangeText={setTextFallbackDraft}
              placeholder="King's Cross to Edinburgh tomorrow morning"
              placeholderTextColor="#6b7280"
              style={styles.textFallbackInput}
              returnKeyType="send"
              onSubmitEditing={() => { void handleTextFallbackSend(); }}
            />
            <View style={styles.textFallbackActions}>
              <Pressable onPress={() => setTextFallbackVisible(false)} style={styles.textFallbackSecondary}>
                <Text style={styles.textFallbackSecondaryText}>Not now</Text>
              </Pressable>
              <Pressable
                onPress={() => { void handleTextFallbackSend(); }}
                style={[
                  styles.textFallbackPrimary,
                  !textFallbackDraft.trim() && styles.textFallbackPrimaryDisabled,
                ]}
                disabled={!textFallbackDraft.trim()}
              >
                <Text style={styles.textFallbackPrimaryText}>Send to Ace</Text>
              </Pressable>
            </View>
          </View>
        )}

        <OrbAnimation
          phase={phase}
          onPress={handleOrbTap}
          disabled={isBusy || isConfirming}
        />

        {(isIdle || isError) && turns.length > 0 && (
          <Pressable onPress={() => reset()} style={styles.clearBtn} hitSlop={12}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        )}
      </View>
      )}

    </SafeAreaView>
  );
}

// ── Suggestion chip ───────────────────────────────────────────────────────────

function Suggestion({ icon, text, onPress }: { icon: string; text: string; onPress: () => void }) {
  return (
    <Pressable style={suggStyles.chip} onPress={onPress}>
      <View style={suggStyles.iconWrap}>
        <Ionicons name={icon as any} size={13} color="#dcecff" />
      </View>
      <View style={suggStyles.copy}>
        <Text style={suggStyles.text}>{text}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
    </Pressable>
  );
}

function Atmosphere() {
  return (
    <View pointerEvents="none" style={styles.atmosphere}>
      <LinearGradient
        colors={['rgba(164, 212, 255, 0.16)', 'rgba(164, 212, 255, 0)']}
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
    paddingVertical: 12,
    marginBottom: 8,
    width: '100%',
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: 'rgba(24, 38, 55, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  text: { fontSize: 13, color: C.textPrimary, letterSpacing: 0.1, fontWeight: '600' },
});

// ── Styles ────────────────────────────────────────────────────────────────────

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
    gap: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerMarkWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f4f7fb',
    letterSpacing: 2.2,
  },
  headerSubtitle: {
    fontSize: 10,
    color: '#6f7d8d',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  nearBadge: {
    backgroundColor: 'rgba(10, 16, 26, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(113, 140, 170, 0.18)',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  nearBadgeText: { fontSize: 11, color: '#9fb0c2', fontWeight: '600' },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(113, 140, 170, 0.16)',
    backgroundColor: 'rgba(8, 14, 22, 0.84)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 260 },
  scrollContentConfirming: { paddingBottom: 48 },

  emptyState:    { paddingTop: 22, paddingBottom: 20 },
  heroCard: {
    backgroundColor: 'rgba(6, 13, 24, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.4)',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 22,
    marginBottom: 22,
    shadowColor: '#020617',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  emptyGreeting: {
    fontSize: 38,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 12,
    letterSpacing: -1.0,
    lineHeight: 44,
  },
  heroExample: {
    marginTop: 22,
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: -0.7,
    textAlign: 'center',
    color: '#e5edf7',
    fontWeight: '500',
  },
  heroResponse: {
    marginTop: 14,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    color: '#7f95aa',
    fontWeight: '500',
  },
  modeCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(122, 167, 214, 0.16)',
    backgroundColor: 'rgba(8, 14, 22, 0.72)',
    padding: 16,
    marginBottom: 18,
  },
  modeHeader: {
    marginBottom: 12,
  },
  modeEyebrow: {
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  modeBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(113, 140, 170, 0.14)',
    backgroundColor: 'rgba(11, 17, 27, 0.72)',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modeBtnActive: {
    backgroundColor: 'rgba(16, 24, 35, 0.9)',
    borderColor: 'rgba(171, 207, 239, 0.28)',
  },
  modeBtnSharedActive: {
    backgroundColor: 'rgba(17, 24, 36, 0.9)',
    borderColor: 'rgba(194, 208, 226, 0.26)',
  },
  modeBtnText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  modeBtnTextActive: {
    color: '#f8fafc',
  },
  modeBtnTextShared: {
    color: '#faf5ff',
  },
  modeFootnote: {
    color: C.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  activeTripCard: {
    backgroundColor: 'rgba(8, 14, 22, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(122, 167, 214, 0.16)',
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
    backgroundColor: 'rgba(18, 26, 39, 0.92)',
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
    color: '#bed0e3',
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
    backgroundColor: 'rgba(8, 12, 18, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(113, 140, 170, 0.14)',
    borderRadius: 24,
    padding: 18,
  },
  suggestionsHeader: {
    marginBottom: 10,
  },
  suggestionsEyebrow: {
    fontSize: 11,
    color: '#8ea1b5',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
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
    backgroundColor: '#dcecff',
    shadowColor: '#dcecff',
    shadowOpacity: 0.5,
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
    backgroundColor: 'rgba(18, 31, 46, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    borderWidth: 1,
    borderColor: 'rgba(169, 220, 255, 0.28)',
  },
  avatarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#dcecff',
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
    borderLeftColor: '#8dbfe7',
  },
  recentTurnsCard: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(6, 13, 24, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.24)',
  },
  recentTurnsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  recentTurnsEyebrow: {
    fontSize: 11,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  recentTurnsCount: {
    fontSize: 11,
    color: '#64748b',
  },

  confirmCard: {
    borderWidth: 1,
    borderColor: 'rgba(156, 204, 240, 0.28)',
    borderRadius: 34,
    paddingHorizontal: 26,
    paddingTop: 28,
    paddingBottom: 20,
    marginBottom: 10,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(4, 10, 18, 0.96)',
    shadowColor: '#9cccf0',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 34,
    elevation: 18,
  },
  confirmEyebrow: {
    fontSize: 11,
    color: '#d7e6f5',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: 14,
  },
  confirmTrip: {
    fontSize: 22,
    color: '#eef6ff',
    textAlign: 'center',
    lineHeight: 30,
    letterSpacing: -0.5,
    fontWeight: '700',
    marginBottom: 8,
  },
  confirmMeta: {
    fontSize: 12,
    color: '#89a5bf',
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.2,
    marginBottom: 12,
  },
  assumptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.18)',
    backgroundColor: 'rgba(8, 18, 32, 0.72)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  assumptionText: {
    flex: 1,
    fontSize: 12,
    color: '#cbd5e1',
    lineHeight: 18,
  },
  confirmPrice: {
    fontSize: 54,
    fontWeight: '800',
    color: C.textPrimary,
    textAlign: 'center',
    letterSpacing: -2,
    marginTop: 6,
    marginBottom: 12,
  },
  confirmDecision: {
    fontSize: 15,
    color: '#d9e7f5',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 14,
  },
  confirmFootnote: {
    fontSize: 12,
    color: '#7f91a4',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  confirmSecurityLine: {
    fontSize: 12,
    color: '#9eb8d2',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  confirmRetryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(252, 211, 77, 0.28)',
    backgroundColor: 'rgba(120, 53, 15, 0.16)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  confirmRetryText: {
    flex: 1,
    fontSize: 12,
    color: '#fef3c7',
    lineHeight: 18,
  },
  confirmBtn: {
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 8,
  },
  confirmBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 19,
  },
  confirmText: { fontSize: 16, color: '#edf6ff', fontWeight: '700', letterSpacing: 0.2 },
  confirmCancel: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  confirmCancelText: { fontSize: 13, color: C.textDim },

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
  textFallbackCard: {
    width: '100%',
    marginBottom: 14,
    padding: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(12, 12, 11, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(212, 194, 163, 0.24)',
    gap: 10,
  },
  textFallbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textFallbackTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#f4ead6',
    fontWeight: '700',
  },
  textFallbackBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#cbd5e1',
  },
  textFallbackInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(71, 85, 105, 0.55)',
    backgroundColor: 'rgba(2, 6, 12, 0.85)',
    color: '#e5e7eb',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textFallbackActions: {
    flexDirection: 'row',
    gap: 10,
  },
  textFallbackPrimary: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#d4c2a3',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  textFallbackPrimaryDisabled: {
    opacity: 0.45,
  },
  textFallbackPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  textFallbackSecondary: {
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textFallbackSecondaryText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
  },
  clearBtn: { marginTop: 18 },
  clearBtnText: { fontSize: 13, color: C.textDim, letterSpacing: 0.3 },

  usualRouteCard: {
    backgroundColor: 'rgba(8, 14, 22, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(122, 167, 214, 0.16)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
    width: '100%',
  },
  usualRouteRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  usualRouteLabel: { fontSize: 11, color: '#c9d9e8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  usualRouteCount: { fontSize: 11, color: '#8ea1b5', opacity: 0.8, marginLeft: 'auto' as any },
  usualRouteRoute: { fontSize: 16, color: '#f8fafc', fontWeight: '700', marginBottom: 2 },
  usualRouteFare:  { fontSize: 12, color: '#7e8d9d' },
  sharedUnitCard: {
    backgroundColor: 'rgba(8, 14, 22, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(122, 167, 214, 0.16)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    width: '100%',
  },
  sharedUnitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sharedUnitLabel: { fontSize: 14, color: '#eef5fb', fontWeight: '700', flex: 1 },
  sharedUnitMeta: {
    fontSize: 11,
    color: '#9db1c5',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  sharedUnitBody: {
    fontSize: 12,
    color: '#aebfd0',
    lineHeight: 18,
    marginBottom: 12,
  },
  sharedUnitActions: {
    flexDirection: 'row',
    gap: 10,
  },
  sharedUnitBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#dcecff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  sharedUnitBtnSecondary: {
    backgroundColor: 'rgba(12, 19, 29, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(122, 167, 214, 0.18)',
  },
  sharedUnitBtnText: {
    fontSize: 12,
    color: '#0e1722',
    fontWeight: '700',
  },
  sharedUnitBtnTextSecondary: {
    color: '#d9e7f4',
  },
  travelModePromptCard: {
    backgroundColor: 'rgba(8, 14, 22, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(122, 167, 214, 0.16)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 10,
    width: '100%',
  },
  travelModePromptHeader: {
    marginBottom: 6,
  },
  travelModePromptEyebrow: {
    fontSize: 11,
    color: '#c9d9e8',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  travelModePromptTitle: {
    fontSize: 16,
    color: '#f4f8fc',
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  travelModePromptBody: {
    fontSize: 12,
    color: '#aebfd0',
    lineHeight: 18,
    marginBottom: 12,
  },
  travelModePromptActions: {
    flexDirection: 'row',
    gap: 10,
  },
  travelModePromptPrimary: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#dcecff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  travelModePromptPrimaryText: {
    fontSize: 12,
    color: '#0e1722',
    fontWeight: '700',
  },
  travelModePromptSecondary: {
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  travelModePromptSecondaryText: {
    fontSize: 12,
    color: '#9db1c5',
    fontWeight: '600',
  },
  myTripsBtn:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#1e293b', marginBottom: 10 },
  myTripsBtnText:  { fontSize: 13, color: '#64748b' },
});
