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
import { getLocationContext } from '../../lib/location';
import type { StationGeo } from '../../lib/stationGeo';
import { fetchRate } from '../../lib/currency';
import { formatMoneyAmount, isZeroDecimalCurrency } from '../../lib/money';
import { tripCards, type ProactiveCard, type TripContext } from '../../lib/trip';
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
  const [preferredTravelUnit, setPreferredTravelUnit] = useState<TravelUnit | null>(null);
  const [bookingMode, setBookingMode] = useState<BookingMode>('solo');
  const [textFallbackVisible, setTextFallbackVisible] = useState(false);
  const [textFallbackDraft, setTextFallbackDraft] = useState('');
  const [confirmRetryNote, setConfirmRetryNote] = useState<string | null>(null);

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
      const sharedUnit = await loadPreferredTravelUnit().catch(() => null);
      if (active) {
        setPreferredTravelUnit(sharedUnit);
        setBookingMode(sharedUnit ? 'shared' : 'solo');
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
  }, [speakIfEnabled]);

  // ── UPI pay (India only) ─────────────────────────────────────────────────

  const handleUpiPay = useCallback(async () => {
    await speakIfEnabled('Payment happens after Ace creates the booking request.');
  }, [speakIfEnabled]);

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
  const recentTurns = turns.filter((turn) => turn.role === 'meridian').slice(-4);
  return (
    <SafeAreaView style={styles.safe}>
      <Atmosphere />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <View style={styles.headerDot} />
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
        contentContainerStyle={[styles.scrollContent, isConfirming && styles.scrollContentConfirming]}
        showsVerticalScrollIndicator={false}
      >
        {turns.length === 0 && isIdle && (
          <View style={styles.emptyState}>
            <View style={styles.heroCard}>
              <View style={styles.heroTopline}>
                <Text style={styles.emptyEyebrow}>Ask naturally</Text>
                <View style={styles.heroToplineRule} />
              </View>
              <Text style={styles.emptyGreeting}>
                {userName !== 'there' ? `${timeGreeting}, ${userName}.` : `${timeGreeting}.`}
              </Text>
              <Text style={styles.heroHeadline}>Ask once. Ace handles the rest.</Text>
              <Text style={styles.emptyHint}>
                {lastRouteHint
                  ? `${lastRouteHint} Touch Ace, say it naturally, and it will take it from there.`
                  : nearestStation
                  ? `You are in ${locationLabel ?? 'your area'}. Ace will choose the best departure point from nearby, line up the route, and secure it if you want.`
                  : `Say where you are going and Ace will line up the route, secure it, and stay with the trip.`}
              </Text>
              {preferredTravelUnit && (
                <View style={styles.modeCard}>
                  <View style={styles.modeHeader}>
                    <Text style={styles.modeEyebrow}>Who is travelling?</Text>
                    <Text style={styles.modeHint}>
                      If both phones are open, choose whether this request is just for you or for {preferredTravelUnit.name}.
                    </Text>
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
                      ? 'Ace will plan this as a shared trip and keep approvals stricter.'
                      : 'Ace will treat this as a solo booking unless you ask for the household.'}
                  </Text>
                </View>
              )}
              <View style={styles.heroStatRow}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>Voice first</Text>
                  <Text style={styles.heroStatLabel}>natural requests</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>Fast start</Text>
                  <Text style={styles.heroStatLabel}>Ace takes it from here</Text>
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
                    if (activeTrip.fromStation) params.fromStation = activeTrip.fromStation;
                    if (activeTrip.toStation) params.toStation = activeTrip.toStation;
                    if (activeTrip.departureTime) params.departureTime = activeTrip.departureTime;
                    if (activeTrip.platform) params.platform = activeTrip.platform;
                    if (activeTrip.operator) params.operator = activeTrip.operator;
                    if (activeTrip.finalLegSummary) params.finalLegSummary = activeTrip.finalLegSummary;
                    if (activeTrip.shareToken) params.shareToken = activeTrip.shareToken;
                    if (activeTrip.tripContext) params.tripContext = JSON.stringify(activeTrip.tripContext);
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
                onPress={() => { void runIntentWithUiFallback(`${usualRoute.origin} to ${usualRoute.destination}`); }}
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
            {preferredTravelUnit && (
              <View style={styles.sharedUnitCard}>
                <View style={styles.sharedUnitHeader}>
                  <Ionicons name="people-circle-outline" size={16} color="#f0abfc" />
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
            <Pressable onPress={() => router.push('/(main)/trips')} style={styles.myTripsBtn}>
              <Ionicons name="time-outline" size={14} color="#64748b" style={{ marginRight: 6 }} />
              <Text style={styles.myTripsBtnText}>Journeys</Text>
              <Ionicons name="chevron-forward-outline" size={13} color="#334155" style={{ marginLeft: 'auto' }} />
            </Pressable>
            <View style={styles.suggestionsCard}>
              <View style={styles.suggestionsHeader}>
                <Text style={styles.suggestionsEyebrow}>Try one of these</Text>
                <Text style={styles.suggestionsHint}>Speak naturally. Ace will infer the route, recommend the strongest option, and only ask when something truly matters.</Text>
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
                    onPress={() => { void runIntentWithUiFallback(suggestion); }}
                  />
                ))}
              </View>
            </View>
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
          const recommendation = buildRecommendationBrief({
            plan,
            sourceLabel,
            familyRailcardReady,
          });
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
              {pendingPlanRef.current?.assumptionNote && (
                <View style={styles.assumptionCard}>
                  <Ionicons name="locate-outline" size={14} color="#93c5fd" />
                  <Text style={styles.assumptionText}>{pendingPlanRef.current.assumptionNote}</Text>
                </View>
              )}
              {recommendation && (
                <View style={styles.recommendationCard}>
                  <View style={styles.recommendationHeader}>
                    <Ionicons name="sparkles" size={14} color="#f4ead6" />
                    <Text style={styles.recommendationEyebrow}>Recommended for you</Text>
                  </View>
                  <Text style={styles.recommendationTitle}>{recommendation.title}</Text>
                  <Text style={styles.recommendationWhy}>{recommendation.why}</Text>
                  <View style={styles.recommendationCueRow}>
                    {recommendation.cues.map((cue) => (
                      <View key={cue} style={styles.recommendationCue}>
                        <Text style={styles.recommendationCueText}>{cue}</Text>
                      </View>
                    ))}
                  </View>
                </View>
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
                      <Text style={styles.groupReadyText}>Ace will check Family & Friends Railcard eligibility before it secures any UK rail leg.</Text>
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
                <Text style={styles.confirmPrice}>{sourceLabel === 'Estimated fare' ? `From ${priceLabel}` : priceLabel}</Text>
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
                    return (
                      <View key={i} style={styles.passengerRow}>
                        <View style={styles.passengerPill}>
                          <Text style={styles.passengerPillText}>
                            {p.relationship === 'infant' ? '👶' : p.relationship === 'child' ? '🧒' : '🧑'} {p.name}
                          </Text>
                        </View>
                        <Text style={styles.passengerFare}>
                          {p.relationship === 'infant' ? 'Infant' : p.relationship === 'child' ? 'Child' : 'Adult'}
                        </Text>
                      </View>
                    );
                  })}
                  <Text style={styles.passengerHint}>
                    Final passenger-specific fares and discounts are checked during booking, not split here.
                  </Text>
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
                <Text style={{ fontSize: 11, color: '#6b7280' }}>Booking fee </Text>
                <View style={{ backgroundColor: '#052e16', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 11, color: '#4ade80', fontWeight: '600' }}>Included for now</Text>
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
                  <Text style={styles.readinessTitle}>Before Ace secures it</Text>
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
              <View style={styles.assuranceCard}>
                <View style={styles.assuranceHeader}>
                  <Ionicons name="sparkles-outline" size={14} color="#d4c2a3" />
                  <Text style={styles.assuranceTitle}>What Ace has covered</Text>
                </View>
                {buildAssuranceItems({
                  plan,
                  fiatAmount: fiat,
                  hasCards: cards.length > 0,
                }).map((item) => (
                  <View key={item} style={styles.assuranceRow}>
                    <View style={styles.assuranceDot} />
                    <Text style={styles.assuranceText}>{item}</Text>
                  </View>
                ))}
              </View>
              {confirmRetryNote && (
                <View style={styles.confirmRetryCard}>
                  <Ionicons name="refresh-outline" size={14} color="#fcd34d" />
                  <Text style={styles.confirmRetryText}>{confirmRetryNote}</Text>
                </View>
              )}
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
                    <Text style={styles.upiBtnText}>How this works</Text>
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

        {(isIdle || isError || phase === 'listening') && (
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
              <Ionicons name="create-outline" size={14} color="#d4c2a3" />
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

        <Text style={[styles.phaseLabel, { color: PHASE_LABEL_COLOR[phase] ?? C.textMuted }]}>
          {phaseLabel}
        </Text>

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

function suggestionSupportLine(text: string): string {
  if (text.toLowerCase().includes('cheapest')) return 'Ace will compare a stronger option against the cheapest.';
  if (text.toLowerCase().includes('next train')) return 'Ace will line up the next live departures and recommend one.';
  if (text.toLowerCase().includes('route')) return 'Ace will choose the best route and explain why.';
  return 'Ace will line up the route, price, and strongest next step.';
}

function Suggestion({ icon, text, onPress }: { icon: string; text: string; onPress: () => void }) {
  return (
    <Pressable style={suggStyles.chip} onPress={onPress}>
      <View style={suggStyles.iconWrap}>
        <Ionicons name={icon as any} size={13} color={C.em} />
      </View>
      <View style={suggStyles.copy}>
        <Text style={suggStyles.text}>{text}</Text>
        <Text style={suggStyles.subtext}>{suggestionSupportLine(text)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
    </Pressable>
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
    paddingVertical: 12,
    marginBottom: 8,
    width: '100%',
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: C.emDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  text: { fontSize: 13, color: C.textPrimary, letterSpacing: 0.1, fontWeight: '600' },
  subtext: { fontSize: 11, color: C.textMuted, lineHeight: 16, marginTop: 3 },
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
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 260 },
  scrollContentConfirming: { paddingBottom: 48 },

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
  modeCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.16)',
    backgroundColor: 'rgba(7, 14, 24, 0.84)',
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
  modeHint: {
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 19,
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
    borderColor: 'rgba(148, 163, 184, 0.14)',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modeBtnActive: {
    backgroundColor: 'rgba(8, 47, 73, 0.92)',
    borderColor: 'rgba(125, 211, 252, 0.34)',
  },
  modeBtnSharedActive: {
    backgroundColor: 'rgba(48, 16, 82, 0.9)',
    borderColor: 'rgba(216, 180, 254, 0.38)',
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
  recommendationCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(244, 234, 214, 0.16)',
    backgroundColor: 'rgba(24, 20, 15, 0.72)',
    padding: 14,
    gap: 10,
  },
  recommendationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recommendationEyebrow: {
    fontSize: 11,
    color: '#f4ead6',
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  recommendationTitle: {
    fontSize: 18,
    color: '#f8fafc',
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  recommendationWhy: {
    fontSize: 12,
    color: '#d6d3d1',
    lineHeight: 18,
  },
  recommendationCueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recommendationCue: {
    borderRadius: 999,
    backgroundColor: 'rgba(8, 18, 32, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recommendationCueText: {
    fontSize: 11,
    color: '#bae6fd',
    fontWeight: '600',
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
  assuranceCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(212, 194, 163, 0.18)',
    backgroundColor: 'rgba(19, 15, 10, 0.55)',
    padding: 12,
    gap: 8,
  },
  assuranceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assuranceTitle: {
    fontSize: 12,
    color: '#f4ead6',
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  assuranceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assuranceDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d4c2a3',
  },
  assuranceText: {
    fontSize: 11,
    color: '#d6d3d1',
    lineHeight: 16,
  },
  confirmRetryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
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
  passengerHint: { marginTop: 6, fontSize: 11, lineHeight: 16, color: C.textMuted },

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
  sharedUnitCard: {
    backgroundColor: '#16091b',
    borderWidth: 1,
    borderColor: '#581c87',
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
  sharedUnitLabel: {
    fontSize: 14,
    color: '#f5d0fe',
    fontWeight: '700',
    flex: 1,
  },
  sharedUnitMeta: {
    fontSize: 11,
    color: '#d8b4fe',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  sharedUnitBody: {
    fontSize: 12,
    color: '#e9d5ff',
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
    backgroundColor: '#a855f7',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  sharedUnitBtnSecondary: {
    backgroundColor: '#22132f',
    borderWidth: 1,
    borderColor: '#6b21a8',
  },
  sharedUnitBtnText: {
    fontSize: 12,
    color: '#faf5ff',
    fontWeight: '700',
  },
  sharedUnitBtnTextSecondary: {
    color: '#e9d5ff',
  },
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
