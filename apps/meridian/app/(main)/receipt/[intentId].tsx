/**
 * Receipt screen — signed settlement proof + boarding QR
 *
 * - Shows journey details + HMAC-verified payment proof
 * - "Show Ticket" → full-screen QR mode for station staff
 * - Caches QR image locally via expo-file-system (works offline)
 * - Saves trip to AsyncStorage for My Trips history
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Share,
  Modal,
  Image,
  Dimensions,
  TextInput,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import { getConciergeExecution, getReceipt, type Receipt, reportIssue, registerJobWatch, getIntentStatus, createCheckoutSession, createUpiPaymentLink } from '../../../lib/api';
import { formatMoney, formatMoneyAmount } from '../../../lib/money';
import { useStore } from '../../../lib/store';
import { loadActiveTrip, loadJourneySession, patchJourneySession, saveActiveTrip, saveJourneySession, upsertTrip, recordRouteMemory, type JourneySession } from '../../../lib/storage';
import { scheduleHotelNotifications, scheduleJourneyNotifications, scheduleProactiveRerouteReminder, scheduleProactiveRouteReminder, scheduleTravelDayNudge, requestNotificationPermission, getExpoPushToken } from '../../../lib/notifications';
import { fetchWeatherForStation, type WeatherData } from '../../../lib/weather';
import { applyTripDisruption, parseTripContext, paymentConfirmedFromMetadata, syncTripBookingState, tripCards, type ProactiveCard, type TripContext } from '../../../lib/trip';
import { loadProfileRaw } from '../../../lib/profile';
import { createReceiptPdf, type ReceiptPdfSection } from '../../../lib/receiptPdf';
import { trackClientEvent } from '../../../lib/telemetry';
import { journeyRecovery } from '../../../lib/journeyRecovery';

const { width: SCREEN_W } = Dimensions.get('window');
const QR_SIZE = Math.min(SCREEN_W - 80, 280);

function qrUrl(ref: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(ref)}&format=png&margin=2`;
}

function repeatPrompt(params: {
  transcript?: string | null;
  fromStation?: string | null;
  toStation?: string | null;
  destination?: string | null;
}) {
  if (params.transcript?.trim()) return params.transcript.trim();
  if (params.fromStation && params.toStation) return `${params.fromStation} to ${params.toStation} again`;
  if (params.destination) return `${params.destination} again`;
  return null;
}

function receiptModeMeta(trip: TripContext | null, hasFlightDetails: boolean) {
  if (trip?.mode === 'mixed') return { icon: 'navigate-outline' as const, title: 'Journey details', noun: 'journey' };
  if (trip?.mode === 'bus') return { icon: 'bus-outline' as const, title: 'Coach details', noun: 'coach' };
  if (trip?.mode === 'hotel') return { icon: 'bed-outline' as const, title: 'Stay details', noun: 'stay' };
  if (trip?.mode === 'local') return { icon: 'subway-outline' as const, title: 'Local details', noun: 'route' };
  if (trip?.mode === 'flight' || hasFlightDetails) {
    return { icon: 'airplane-outline' as const, title: 'Flight details', noun: 'flight' };
  }
  return { icon: 'train-outline' as const, title: 'Journey details', noun: 'service' };
}

function flightCompletionRows(flight: {
  pnr?: string;
  isReturn?: boolean;
}) {
  return [
    {
      label: 'Confirmed now',
      value: flight.pnr ? `Booking reference ${flight.pnr} is in place.` : 'Flights, timing, and fare are lined up.',
      tone: 'ready' as const,
    },
    {
      label: 'Still to come',
      value: flight.pnr
        ? 'Seat and baggage details stay under the airline flow from here.'
        : 'Booking reference lands once the airline finishes issuing the order.',
      tone: 'pending' as const,
    },
    flight.isReturn
      ? {
          label: 'Return leg',
          value: 'Both directions stay together under the same trip record.',
          tone: 'ready' as const,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string; tone: 'ready' | 'pending' }>;
}

function legModeIcon(mode: TripContext['mode'] | TripContext['legs'][number]['mode']) {
  if (mode === 'flight') return '✈️';
  if (mode === 'hotel') return '🏨';
  if (mode === 'bus') return '🚌';
  if (mode === 'local') return '🚇';
  return '🚂';
}

function formatLegMoment(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  return value;
}

function fallbackCurrencySymbol(code?: string | null): string {
  const resolved = (code ?? '').toUpperCase();
  if (resolved === 'GBP') return '£';
  if (resolved === 'INR') return '₹';
  if (resolved === 'USD') return '$';
  if (resolved === 'EUR') return 'EUR ';
  return resolved ? `${resolved} ` : '';
}

function isRollbackState(bookingState: TripContext['watchState'] extends infer T ? T extends { bookingState?: infer B } ? B : never : never, totalLegs: number) {
  return totalLegs > 1 && (bookingState === 'failed' || bookingState === 'refunded');
}

export default function ReceiptScreen() {
  const params = useLocalSearchParams<{
    intentId: string;
    bookingRef?: string;
    departureTime?: string;
    departureDatetime?: string;
    arrivalTime?: string;
    platform?: string;
    operator?: string;
    finalLegSummary?: string;
    fromStation?: string;
    toStation?: string;
    fiatAmount?: string;
    currencySymbol?: string;
    currencyCode?: string;
    cancelled?: string;
    delayed?: string;
    delayMinutes?: string;
    platformChanged?: string;
    notifiedPlatform?: string;
    gateUpdated?: string;
    notifiedGate?: string;
    disruptionRoute?: string;
    transcript?: string;
    flightData?: string;
    tripContext?: string;
    shareToken?: string;
    arrived?: string;
    destination?: string;
    hotelCheckInSoon?: string;
    hotelCheckoutSoon?: string;
    partnerCheckoutUrl?: string;
  }>();
  const {
    intentId, bookingRef, departureTime, departureDatetime, arrivalTime, platform, operator,
    fromStation, toStation,
    finalLegSummary,
    fiatAmount: fiatAmountParam, currencySymbol: symParam, currencyCode: codeParam,
    cancelled,
    delayed,
    delayMinutes,
    platformChanged,
    notifiedPlatform,
    gateUpdated,
    notifiedGate,
    disruptionRoute,
    transcript,
    tripContext: tripContextParam,
    shareToken: shareTokenParam,
    arrived,
    destination,
    hotelCheckInSoon,
    hotelCheckoutSoon,
    partnerCheckoutUrl: partnerCheckoutUrlParam,
  } = params;

  const isCancelled = cancelled === 'true';
  const hasArrived = arrived === 'true';
  const isDelayed = delayed === 'true';
  const hasPlatformChanged = platformChanged === 'true';
  const hasGateUpdated = gateUpdated === 'true';
  const hasHotelCheckInSoon = hotelCheckInSoon === 'true';
  const hasHotelCheckoutSoon = hotelCheckoutSoon === 'true';

  // Flight card: parse JSON param if present
  type FlightData = {
    origin: string; destination: string;
    departureAt: string; arrivalAt: string;
    carrier: string; flightNumber: string;
    totalAmount: number; currency: string;
    stops: number; cabinClass: string; isReturn: boolean;
    pnr?: string;
  };
  const flightDetails: FlightData | null = params.flightData
    ? (() => { try { return JSON.parse(params.flightData) as FlightData; } catch { return null; } })()
    : null;

  // Fiat display: prefer URL params (passed from booking flow), fall back to receipt.amount
  const fiatSymbol   = symParam  ?? '£';
  const fiatCode     = codeParam ?? 'GBP';
  const fiatAmountNum = fiatAmountParam ? parseFloat(fiatAmountParam) : null;
  const { reset, currentAgent, agentId } = useStore();
  const [receipt,     setReceipt]     = useState<Receipt | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [showTicket,  setShowTicket]  = useState(false);
  const [qrLocalUri,  setQrLocalUri]  = useState<string | null>(null);
  const [qrLoading,   setQrLoading]   = useState(false);
  const [preservedFinalLegSummary, setPreservedFinalLegSummary] = useState<string | null>(finalLegSummary ?? null);
  const [showIssue,    setShowIssue]    = useState(false);
  const [issueText,    setIssueText]    = useState('');
  const [issueSending, setIssueSending] = useState(false);
  const [issueSent,    setIssueSent]    = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [tripContext, setTripContext] = useState<TripContext | null>(() => parseTripContext(tripContextParam));
  const [shareToken, setShareToken] = useState<string | null>(shareTokenParam ?? null);
  const [hotelDetails, setHotelDetails] = useState<{ city: string; checkIn: string; checkOut: string; bestOption: { name: string; stars: number; ratePerNight: number; totalCost: number; currency: string; area: string; bookingUrl?: string } } | null>(null);
  const [partnerCheckoutUrl, setPartnerCheckoutUrl] = useState<string | null>(null);
  const [walletPassUrl, setWalletPassUrl] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [paymentCheckLoading, setPaymentCheckLoading] = useState(false);
  const [paymentRecoveryNote, setPaymentRecoveryNote] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const [travellerName, setTravellerName] = useState<string | null>(null);
  const [travellerEmail, setTravellerEmail] = useState<string | null>(null);
  const [exportAction, setExportAction] = useState<'pdf' | 'email' | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [journeySession, setJourneySession] = useState<JourneySession | null>(null);
  const rerouteReminderScheduledRef = useRef(false);
  const walletTelemetryTrackedRef = useRef(false);
  const rerouteTelemetryTrackedRef = useRef(false);
  const exportPdfUriRef = useRef<string | null>(null);

  const logReceiptEvent = (params: {
    event: string;
    severity?: 'info' | 'warning' | 'error';
    message?: string;
    metadata?: Record<string, unknown>;
  }) => {
    void trackClientEvent({
      event: params.event,
      screen: 'receipt',
      severity: params.severity,
      message: params.message,
      metadata: params.metadata,
    });
  };

  const hasJourneyDetails = !!(bookingRef || departureTime || fromStation);
  const repeatRoutePrompt = repeatPrompt({
    transcript: transcript ?? null,
    fromStation: fromStation ?? null,
    toStation: toStation ?? null,
    destination: destination ?? null,
  });
  const recoveryPrompt =
    transcript ||
    (fromStation && toStation ? `${fromStation} to ${toStation} next available` : null);
  const cards = tripCards(tripContext);
  const modeMeta = receiptModeMeta(tripContext, !!flightDetails);
  const tripLegs = tripContext?.legs ?? [];
  const isMultiLegJourney = tripLegs.length > 1;
  const paymentRequired = !!((fiatAmountNum ?? receipt?.amount ?? 0) > 0);
  const bookingState = tripContext?.watchState?.bookingState;
  const rolledBackJourney = isRollbackState(bookingState, tripLegs.length || 1);
  const liveJourneySession: JourneySession = {
    ...(journeySession ?? {}),
    intentId,
    jobId: journeySession?.jobId ?? null,
    journeyId: journeySession?.journeyId ?? null,
    title: tripContext?.title ?? journeySession?.title ?? (fromStation && toStation ? `${fromStation} -> ${toStation}` : 'Journey'),
    state:
      rolledBackJourney || bookingState === 'failed' || bookingState === 'refunded' ? 'attention'
      : receipt?.verifiedAt ? 'ticketed'
      : bookingState === 'payment_pending' ? 'payment_pending'
      : 'ticketed',
    intentStatus: journeySession?.intentStatus ?? receipt?.status ?? null,
    bookingState: tripContext?.watchState?.bookingState ?? journeySession?.bookingState,
    fromStation: fromStation ?? journeySession?.fromStation ?? null,
    toStation: toStation ?? journeySession?.toStation ?? null,
    departureTime: departureTime ?? journeySession?.departureTime ?? null,
    departureDatetime: departureDatetime ?? journeySession?.departureDatetime ?? null,
    arrivalTime: arrivalTime ?? journeySession?.arrivalTime ?? null,
    platform: platform ?? journeySession?.platform ?? null,
    operator: operator ?? journeySession?.operator ?? null,
    bookingRef: bookingRef ?? journeySession?.bookingRef ?? null,
    finalLegSummary: preservedFinalLegSummary ?? journeySession?.finalLegSummary ?? null,
    fiatAmount: fiatAmountNum ?? journeySession?.fiatAmount ?? null,
    currencySymbol: fiatSymbol ?? journeySession?.currencySymbol ?? null,
    currencyCode: fiatCode ?? journeySession?.currencyCode ?? null,
    tripContext: tripContext ?? journeySession?.tripContext ?? null,
    shareToken: shareToken ?? journeySession?.shareToken ?? null,
    walletPassUrl: walletPassUrl ?? journeySession?.walletPassUrl ?? null,
    walletLastOpenedAt: journeySession?.walletLastOpenedAt ?? null,
    quoteExpiresAt: journeySession?.quoteExpiresAt ?? null,
    paymentConfirmedAt: receipt?.verifiedAt ?? journeySession?.paymentConfirmedAt ?? null,
    openclawDispatchedAt: journeySession?.openclawDispatchedAt ?? null,
    pendingFulfilment: journeySession?.pendingFulfilment ?? null,
    fulfilmentFailed: journeySession?.fulfilmentFailed ?? null,
    rerouteOfferTitle: journeySession?.rerouteOfferTitle ?? null,
    rerouteOfferBody: journeySession?.rerouteOfferBody ?? null,
    rerouteOfferTranscript: journeySession?.rerouteOfferTranscript ?? null,
    rerouteOfferActionLabel: journeySession?.rerouteOfferActionLabel ?? null,
    executionStatus: journeySession?.executionStatus ?? null,
    recoveryBucket: journeySession?.recoveryBucket ?? null,
    recoveryAction: journeySession?.recoveryAction ?? null,
    recoveryReason: journeySession?.recoveryReason ?? null,
    executionSummary: journeySession?.executionSummary ?? null,
    manualReviewRequired: journeySession?.manualReviewRequired ?? null,
    supportState: journeySession?.supportState ?? 'none',
    supportRequestedAt: journeySession?.supportRequestedAt ?? null,
    supportSummary: journeySession?.supportSummary ?? null,
    lastEventKey: journeySession?.lastEventKey ?? null,
    lastEventAt: journeySession?.lastEventAt ?? null,
    updatedAt: new Date().toISOString(),
  };
  const recoveryState = journeyRecovery(liveJourneySession);
  const receiptStatusLabel = recoveryState.statusLabel;
  const liveReroutePrompt =
    liveJourneySession.rerouteOfferTranscript
    || transcript
    || (fromStation && toStation ? `${fromStation} to ${toStation} next available` : null);
  const liveRerouteActionLabel = liveJourneySession.rerouteOfferActionLabel ?? 'Find alternatives';

  useEffect(() => {
    if (!walletPassUrl || walletTelemetryTrackedRef.current) return;
    walletTelemetryTrackedRef.current = true;
    logReceiptEvent({
      event: 'wallet_available',
      metadata: { intentId, source: 'receipt' },
    });
  }, [intentId, walletPassUrl]);

  useEffect(() => {
    if (!cards.some((card) => ['delay_risk', 'connection_risk', 'platform_changed', 'gate_changed'].includes(card.kind)) || rerouteTelemetryTrackedRef.current) {
      return;
    }
    rerouteTelemetryTrackedRef.current = true;
    logReceiptEvent({
      event: 'reroute_offer_available',
      metadata: { intentId, source: 'receipt' },
    });
  }, [cards, intentId]);

  // ── Fetch receipt ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!intentId) return;
    void loadJourneySession(intentId).then((session) => {
      if (session) setJourneySession(session);
    });
    getReceipt(intentId)
      .then((r) => {
        setReceipt(r);
        const hd = (r as any)?.metadata?.hotelDetails;
        if (hd?.bestOption) setHotelDetails(hd);
        const checkoutUrl = (r as any)?.metadata?.partnerCheckoutUrl;
        if (checkoutUrl) setPartnerCheckoutUrl(checkoutUrl);
        const passUrl =
          (r as any)?.metadata?.walletPassUrl
          || (r as any)?.metadata?.appleWalletUrl
          || (r as any)?.metadata?.passUrl
          || null;
        if (passUrl) setWalletPassUrl(passUrl);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [intentId]);

  useEffect(() => {
    if (partnerCheckoutUrlParam) {
      setPartnerCheckoutUrl(partnerCheckoutUrlParam);
    }
  }, [partnerCheckoutUrlParam]);

  useEffect(() => {
    let active = true;
    loadProfileRaw()
      .then((profile) => {
        if (!active || !profile) return;
        setTravellerName(profile.legalName?.trim() || null);
        setTravellerEmail(profile.email?.trim() || null);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    exportPdfUriRef.current = null;
    setExportNote(null);
  }, [intentId, bookingRef, receipt?.verifiedAt]);

  useEffect(() => {
    if (walletPassUrl) return;
    if (partnerCheckoutUrlParam?.endsWith('.pkpass')) {
      setWalletPassUrl(partnerCheckoutUrlParam);
    }
  }, [partnerCheckoutUrlParam, walletPassUrl]);

  useEffect(() => {
    if (finalLegSummary) {
      setPreservedFinalLegSummary(finalLegSummary);
      return;
    }
    void loadActiveTrip().then((trip) => {
      if (trip?.intentId === intentId) {
        if (trip.finalLegSummary) {
          setPreservedFinalLegSummary(trip.finalLegSummary);
        }
        if (trip.tripContext) {
          setTripContext(trip.tripContext);
        }
        if (trip.shareToken) {
          setShareToken(trip.shareToken);
        }
      }
    });
  }, [finalLegSummary, intentId]);

  useEffect(() => {
    if (!tripContext || (!isDelayed && !hasPlatformChanged && !hasGateUpdated)) return;
    const nextTripContext = applyTripDisruption(tripContext, {
      delayed: isDelayed,
      delayMinutes: delayMinutes ?? null,
      platformChanged: hasPlatformChanged,
      notifiedPlatform: notifiedPlatform ?? null,
      gateUpdated: hasGateUpdated,
      notifiedGate: notifiedGate ?? null,
      disruptionRoute: disruptionRoute ?? null,
    });
    if (nextTripContext) {
      setTripContext(nextTripContext);
    }
  }, [tripContext, isDelayed, delayMinutes, hasPlatformChanged, notifiedPlatform, hasGateUpdated, notifiedGate, disruptionRoute]);

  useEffect(() => {
    let active = true;

    if (!fromStation) {
      setWeather(null);
      return () => {
        active = false;
      };
    }

    fetchWeatherForStation(fromStation)
      .then((result) => {
        if (active) setWeather(result);
      })
      .catch(() => {
        if (active) setWeather(null);
      });

    return () => {
      active = false;
    };
  }, [fromStation]);

  // ── Cache QR image locally for offline use ───────────────────────────────
  useEffect(() => {
    if (!bookingRef) return;
    const localPath = `${FileSystem.cacheDirectory}qr_${bookingRef.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    setQrLoading(true);
    FileSystem.getInfoAsync(localPath)
      .then(info => {
        if (info.exists) {
          setQrLocalUri(localPath);
          setQrLoading(false);
        } else {
          return FileSystem.downloadAsync(qrUrl(bookingRef), localPath)
            .then(() => { setQrLocalUri(localPath); })
            .catch(() => { setQrLocalUri(qrUrl(bookingRef)); });
        }
      })
      .catch(() => { setQrLocalUri(qrUrl(bookingRef)); })
      .finally(() => setQrLoading(false));
  }, [bookingRef]);

  // ── Save trip to My Trips history ────────────────────────────────────────
  useEffect(() => {
    if (!receipt || !intentId) return;
    const nextTripContext = syncTripBookingState(tripContext, {
      phase: 'booked',
      bookingConfirmed: true,
      paymentConfirmed: !!receipt.verifiedAt,
      paymentRequired,
      bookingRef: bookingRef ?? undefined,
      origin: fromStation ?? undefined,
      destination: toStation ?? undefined,
      departureTime: departureDatetime ?? departureTime ?? undefined,
      arrivalTime: arrivalTime ?? undefined,
      operator: operator ?? undefined,
      finalLegSummary: preservedFinalLegSummary ?? undefined,
    });
    if (nextTripContext) setTripContext(nextTripContext);
    const isEstimatedDisplay = (() => {
      try {
        const td = (tripContext?.legs && tripContext.legs[0] && (tripContext.legs[0] as any).trainDetails) || null;
        if (td && td.dataSource === 'estimated') return true;
        if (journeySession?.quoteExpiresAt && !receipt?.verifiedAt) return true;
        return false;
      } catch {
        return false;
      }
    })();

    const entry = {
      intentId,
      title:         nextTripContext?.title ?? (fromStation && toStation ? `${fromStation} → ${toStation}` : 'Journey'),
      bookingRef:    bookingRef    ?? null,
      fromStation:   fromStation   ?? null,
      toStation:     toStation     ?? null,
      departureTime: departureTime ?? null,
      arrivalTime:   arrivalTime   ?? null,
      platform:      platform      ?? null,
      operator:      operator      ?? null,
      amount:        receipt.amount,
      currency:      receipt.currency,
      fiatAmount:    fiatAmountNum,
      currencySymbol: fiatSymbol,
      currencyCode:  fiatCode,
      tripContext:   nextTripContext,
      // Helpful flag for tracing whether this displayed amount was an estimate
      isEstimated:   isEstimatedDisplay,
      shareToken,
      savedAt:       new Date().toISOString(),
    };
    void upsertTrip(entry);
    void recordRouteMemory({
      origin: fromStation ?? null,
      destination: toStation ?? destination ?? null,
      departureTime: departureTime ?? null,
      travelDate: departureDatetime ?? departureTime ?? null,
      typicalFareGbp: typeof receipt.amount === 'number' && receipt.currency === 'GBP' ? receipt.amount : null,
    }).then((memory) => {
      if (!memory) return;
      const weekday = memory.weekdays[memory.weekdays.length - 1];
      if (weekday == null) return;
      void scheduleProactiveRouteReminder({
        routeKey: memory.routeKey,
        route: `${memory.origin} to ${memory.destination}`,
        origin: memory.origin,
        destination: memory.destination,
        count: memory.count,
        typicalFareGbp: memory.typicalFareGbp ?? null,
        weekday,
        minutesOfDay: memory.minutesOfDay ?? null,
      });
    });
    void saveActiveTrip({
      intentId,
      journeyId: null,
      status: 'ticketed',
      title: nextTripContext?.title ?? (fromStation && toStation ? `${fromStation} → ${toStation}` : 'Journey'),
      fromStation: fromStation ?? null,
      toStation: toStation ?? null,
      departureTime: departureTime ?? null,
      arrivalTime: arrivalTime ?? null,
      platform: platform ?? null,
      operator: operator ?? null,
      bookingRef: bookingRef ?? null,
      finalLegSummary: preservedFinalLegSummary,
      fiatAmount: fiatAmountNum,
      currencySymbol: fiatSymbol,
      currencyCode: fiatCode,
      tripContext: nextTripContext,
      shareToken,
      walletPassUrl,
      updatedAt: new Date().toISOString(),
    });
    const nextSession: JourneySession = {
      ...(journeySession ?? {}),
      intentId,
      jobId: journeySession?.jobId ?? null,
      journeyId: journeySession?.journeyId ?? null,
      title: nextTripContext?.title ?? (fromStation && toStation ? `${fromStation} -> ${toStation}` : 'Journey'),
      state: receipt?.verifiedAt ? 'ticketed' : bookingState === 'payment_pending' ? 'payment_pending' : 'ticketed',
      intentStatus: journeySession?.intentStatus ?? receipt.status ?? null,
      bookingState: nextTripContext?.watchState?.bookingState ?? bookingState,
      fromStation: fromStation ?? null,
      toStation: toStation ?? null,
      departureTime: departureTime ?? null,
      departureDatetime: departureDatetime ?? departureTime ?? null,
      arrivalTime: arrivalTime ?? nextTripContext?.arrivalTime ?? null,
      platform: platform ?? null,
      operator: operator ?? null,
      bookingRef: bookingRef ?? null,
      finalLegSummary: preservedFinalLegSummary ?? null,
      fiatAmount: fiatAmountNum,
      currencySymbol: fiatSymbol,
      currencyCode: fiatCode,
      tripContext: nextTripContext,
      shareToken,
      walletPassUrl,
      walletLastOpenedAt: journeySession?.walletLastOpenedAt ?? null,
      quoteExpiresAt: journeySession?.quoteExpiresAt ?? null,
      paymentConfirmedAt: receipt.verifiedAt ?? journeySession?.paymentConfirmedAt ?? null,
      openclawDispatchedAt: journeySession?.openclawDispatchedAt ?? null,
      pendingFulfilment: journeySession?.pendingFulfilment ?? null,
      fulfilmentFailed: journeySession?.fulfilmentFailed ?? null,
      rerouteOfferTitle: journeySession?.rerouteOfferTitle ?? null,
      rerouteOfferBody: journeySession?.rerouteOfferBody ?? null,
      rerouteOfferTranscript: journeySession?.rerouteOfferTranscript ?? null,
      rerouteOfferActionLabel: journeySession?.rerouteOfferActionLabel ?? null,
      executionStatus: journeySession?.executionStatus ?? null,
      recoveryBucket: journeySession?.recoveryBucket ?? null,
      recoveryAction: journeySession?.recoveryAction ?? null,
      recoveryReason: journeySession?.recoveryReason ?? null,
      executionSummary: journeySession?.executionSummary ?? null,
      manualReviewRequired: journeySession?.manualReviewRequired ?? null,
      supportState: journeySession?.supportState ?? 'none',
      supportRequestedAt: journeySession?.supportRequestedAt ?? null,
      supportSummary: journeySession?.supportSummary ?? null,
      lastEventKey: journeySession?.lastEventKey ?? null,
      lastEventAt: journeySession?.lastEventAt ?? null,
      updatedAt: new Date().toISOString(),
    };
    setJourneySession(nextSession);
    void saveJourneySession(nextSession);
  }, [receipt, intentId, bookingRef, fromStation, toStation, departureTime, departureDatetime, arrivalTime, platform, operator, preservedFinalLegSummary, fiatAmountNum, fiatSymbol, fiatCode, tripContext, shareToken, paymentRequired, walletPassUrl, bookingState, journeySession?.intentId]);

  // ── Schedule departure notifications ─────────────────────────────────────
  // Prefer departureDatetime (ISO, precise) over departureTime (HH:MM, heuristic)
  useEffect(() => {
    const depStr = departureDatetime ?? departureTime;
    if (!intentId || !depStr) return;
    const route = fromStation && toStation ? `${fromStation} → ${toStation}` : 'Your journey';
    void (async () => {
      const granted = await requestNotificationPermission();
      if (!granted) return;
      await scheduleJourneyNotifications(intentId, depStr, route, platform ?? null, {
        arrivalISO: arrivalTime ?? tripContext?.arrivalTime ?? null,
        destination: toStation ?? destination ?? tripContext?.destination ?? null,
        finalLegSummary: preservedFinalLegSummary ?? tripContext?.finalLegSummary ?? null,
        shareToken,
      });
      await scheduleTravelDayNudge({
        intentId,
        departureISO: depStr,
        route,
        platform: platform ?? null,
        shareToken,
      });
      // Register for platform change push notifications
      const token = await getExpoPushToken();
      if (token) await registerJobWatch(intentId, token);
    })();
  }, [intentId, departureTime, departureDatetime, arrivalTime, fromStation, toStation, destination, platform, preservedFinalLegSummary, tripContext, shareToken]);

  useEffect(() => {
    const hotelLegs = (tripContext?.legs ?? []).filter((leg) => leg.mode === 'hotel');
    const primaryHotel = hotelDetails?.bestOption
      ? {
          hotelName: hotelDetails.bestOption.name,
          city: hotelDetails.city,
          checkInISO: hotelDetails.checkIn,
          checkOutISO: hotelDetails.checkOut,
          bookingUrl: partnerCheckoutUrl ?? hotelDetails.bestOption.bookingUrl ?? null,
        }
      : hotelLegs[0]
      ? {
          hotelName: hotelLegs[0].label ?? hotelLegs[0].operator ?? 'Hotel',
          city: hotelLegs[0].destination ?? hotelLegs[0].origin ?? '',
          checkInISO: hotelLegs[0].departureTime ?? '',
          checkOutISO: hotelLegs[0].arrivalTime ?? null,
          bookingUrl: partnerCheckoutUrl,
        }
      : null;

    if (!intentId || !primaryHotel?.checkInISO) return;

    void (async () => {
      const granted = await requestNotificationPermission();
      if (!granted) return;
      await scheduleHotelNotifications(intentId, {
        ...primaryHotel,
        shareToken,
      });
    })();
  }, [intentId, hotelDetails, tripContext, shareToken, partnerCheckoutUrl]);

  useEffect(() => {
    const route = [fromStation, toStation].filter(Boolean).join(' to ');
    const transcriptForRecovery =
      transcript
      || (route ? `${route} next available` : null);
    const shouldNudge =
      isDelayed
      || hasPlatformChanged
      || hasGateUpdated
      || !!tripContext?.watchState?.delayRisk
      || !!tripContext?.watchState?.connectionRisk;
    if (!intentId || !route || !transcriptForRecovery || !shouldNudge || rerouteReminderScheduledRef.current) return;
    rerouteReminderScheduledRef.current = true;

    const offerTitle = hasPlatformChanged
      ? 'Ace spotted a cleaner platform move'
      : hasGateUpdated
      ? 'Ace spotted a cleaner gate move'
      : isDelayed || tripContext?.watchState?.delayRisk
      ? 'Ace can line up a cleaner train'
      : 'Ace can protect the connection';
    const offerBody = hasPlatformChanged
      ? `Platform ${notifiedPlatform ?? 'details'} changed. Ace can line up the next best route without losing context.`
      : hasGateUpdated
      ? `Gate ${notifiedGate ?? 'details'} changed. Ace can reshape the next clean step for you.`
      : isDelayed || tripContext?.watchState?.delayRisk
      ? 'Timing shifted. Ace can line up the next strongest option before this becomes a scramble.'
      : 'The onward connection is getting tight. Ace can line up a cleaner route now.';
    const offerActionLabel = hasPlatformChanged || hasGateUpdated
      ? 'Find alternatives'
      : tripContext?.watchState?.connectionRisk
      ? 'Protect connection'
      : 'Find alternatives';

    void (async () => {
      await patchJourneySession(intentId, {
        rerouteOfferTitle: offerTitle,
        rerouteOfferBody: offerBody,
        rerouteOfferTranscript: transcriptForRecovery,
        rerouteOfferActionLabel: offerActionLabel,
        lastEventKey: 'reroute_offer',
        lastEventAt: new Date().toISOString(),
      }).catch(() => null);
      const granted = await requestNotificationPermission();
      if (!granted) return;
      await scheduleProactiveRerouteReminder({
        intentId,
        route,
        reason: hasPlatformChanged
          ? 'The platform changed.'
          : hasGateUpdated
          ? 'The gate changed.'
          : isDelayed || tripContext?.watchState?.delayRisk
          ? 'The trip looks delayed.'
          : 'The connection is getting tight.',
        transcript: transcriptForRecovery,
        shareToken,
        offerTitle,
        offerBody,
        offerActionLabel,
      });
    })();
  }, [
    intentId,
    fromStation,
    toStation,
    transcript,
    isDelayed,
    hasPlatformChanged,
    hasGateUpdated,
    notifiedPlatform,
    notifiedGate,
    tripContext?.watchState?.delayRisk,
    tripContext?.watchState?.connectionRisk,
    shareToken,
  ]);

  const handleShare = async () => {
    const heading = receipt ? `Ace — ${modeMeta.title}` : 'Ace — Saved details';
    const detailLine = fromStation && toStation
      ? `${fromStation} → ${toStation}`
      : hotelDetails?.bestOption
      ? `${hotelDetails.bestOption.name} · ${hotelDetails.city}`
      : flightDetails
      ? `${flightDetails.origin} → ${flightDetails.destination}`
      : null;
    const timingLine = departureTime
      ? `Departs: ${departureTime}`
      : hotelDetails?.checkIn
      ? `Check-in: ${hotelDetails.checkIn}`
      : null;
    await Share.share({
      message: [
        heading,
        bookingRef    ? `Reference: ${bookingRef}` : null,
        detailLine,
        timingLine,
        platform && modeMeta.noun === 'service' ? `Platform: ${platform}` : null,
        preservedFinalLegSummary ? `Next: ${preservedFinalLegSummary}` : null,
        fiatAmountNum != null
          ? `Amount: ${formatMoney(fiatAmountNum, fiatSymbol, fiatCode)}`
          : null,
        '',
        'Shared from Ace',
      ].filter(Boolean).join('\n'),
    });
  };

  const buildExpensePdf = async () => {
    if (exportPdfUriRef.current) {
      const existing = await FileSystem.getInfoAsync(exportPdfUriRef.current).catch(() => null);
      if (existing?.exists) {
        return { uri: exportPdfUriRef.current };
      }
    }

    const routeText = fromStation && toStation
      ? `${fromStation} to ${toStation}`
      : flightDetails
      ? `${flightDetails.origin} to ${flightDetails.destination}`
      : hotelDetails?.bestOption
      ? `${hotelDetails.bestOption.name}, ${hotelDetails.city}`
      : tripContext?.title ?? 'Journey details';
    const departureLabel = departureDatetime ?? departureTime ?? hotelDetails?.checkIn ?? flightDetails?.departureAt ?? null;
    const arrivalLabel = arrivalTime ?? hotelDetails?.checkOut ?? flightDetails?.arrivalAt ?? null;
    const processedLabel = receipt?.verifiedAt
      ? new Date(receipt.verifiedAt).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
    const amountText = (() => {
      const isEstimatedDisplay = (() => {
        try {
          const td = (tripContext?.legs && tripContext.legs[0] && (tripContext.legs[0] as any).trainDetails) || null;
          if (td && td.dataSource === 'estimated') return true;
          if (journeySession?.quoteExpiresAt && !receipt?.verifiedAt) return true;
          return false;
        } catch {
          return false;
        }
      })();
      const base = fiatAmountNum != null
        ? formatMoney(fiatAmountNum, fiatSymbol, fiatCode)
        : receipt
        ? formatMoney(receipt.amount, fallbackCurrencySymbol(receipt.currency), receipt.currency)
        : 'Recorded';
      return isEstimatedDisplay ? `${base} (estimated)` : base;
    })();

    const sections: ReceiptPdfSection[] = [
      {
        title: 'Journey',
        rows: [
          { label: 'Receipt type', value: modeMeta.title },
          { label: 'Trip', value: routeText },
          ...(departureLabel ? [{ label: 'Departure', value: departureLabel }] : []),
          ...(arrivalLabel ? [{ label: 'Arrival', value: arrivalLabel }] : []),
          ...(operator ? [{ label: 'Operator', value: operator }] : []),
          ...(platform ? [{ label: 'Platform / gate', value: platform }] : []),
          ...(preservedFinalLegSummary ? [{ label: 'Next step', value: preservedFinalLegSummary }] : []),
          ...(bookingRef ? [{ label: 'Reference', value: bookingRef }] : []),
        ],
      },
      {
        title: 'Traveller',
        rows: [
          ...(travellerName ? [{ label: 'Name', value: travellerName }] : []),
          ...(travellerEmail ? [{ label: 'Email', value: travellerEmail }] : []),
        ],
      },
      {
        title: 'Settlement',
        rows: [
          { label: 'Status', value: receiptStatusLabel },
          { label: 'Amount', value: amountText },
          { label: 'Currency', value: fiatCode ?? receipt?.currency ?? 'GBP' },
          ...(processedLabel ? [{ label: 'Processed', value: processedLabel }] : []),
          { label: 'Intent ID', value: intentId },
          ...(receipt?.signature ? [{ label: 'Settlement signature', value: receipt.signature }] : []),
        ],
      },
    ].filter((section) => section.rows.length > 0);

    const pdf = await createReceiptPdf({
      fileStem: bookingRef ? `ace-receipt-${bookingRef}` : `ace-receipt-${intentId}`,
      title: bookingRef ? `Expense receipt - ${bookingRef}` : 'Expense receipt',
      eyebrow: 'Ace travel receipt',
      statusLabel: receiptStatusLabel,
      amountText,
      subtitle: routeText,
      generatedAtLabel: new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      footerNote: 'Generated by Ace from the live journey record for finance and expense submission.',
      sections,
    });

    exportPdfUriRef.current = pdf.uri;
    return pdf;
  };

  const handleExportPdf = async () => {
    if (exportAction) return;
    setExportAction('pdf');
    setExportNote(null);
    try {
      const { uri } = await buildExpensePdf();
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Export Ace expense receipt',
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Share.share({
          title: 'Ace expense receipt',
          message: `Ace prepared a receipt PDF for ${bookingRef ?? intentId}.`,
          url: uri,
        });
      }
      setExportNote('Expense-ready PDF prepared.');
      logReceiptEvent({
        event: 'receipt_pdf_exported',
        metadata: { intentId, source: 'receipt' },
      });
    } catch (error: any) {
      const message = error?.message ?? 'Ace could not prepare the PDF right now.';
      setExportNote(message);
      logReceiptEvent({
        event: 'receipt_pdf_export_failed',
        severity: 'warning',
        message,
        metadata: { intentId, source: 'receipt' },
      });
    } finally {
      setExportAction(null);
    }
  };

  const handleEmailReceipt = async () => {
    if (exportAction) return;
    setExportAction('email');
    setExportNote(null);
    try {
      const { uri } = await buildExpensePdf();
      const mailAvailable = await MailComposer.isAvailableAsync();
      if (!mailAvailable) {
        const canShare = await Sharing.isAvailableAsync();
        if (!canShare) {
          throw new Error('Mail is unavailable on this device.');
        }
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share Ace expense receipt',
          UTI: 'com.adobe.pdf',
        });
        setExportNote('Mail is unavailable on this device, so Ace opened the receipt in Share instead.');
      } else {
        const subject = bookingRef ? `Ace receipt ${bookingRef}` : `Ace receipt ${intentId}`;
        const routeSummary = fromStation && toStation
          ? `${fromStation} to ${toStation}`
          : tripContext?.title ?? 'your recent journey';
        await MailComposer.composeAsync({
          recipients: travellerEmail ? [travellerEmail] : undefined,
          subject,
          body: `Attached is the Ace receipt for ${routeSummary}.`,
          attachments: [uri],
        });
        setExportNote(
          travellerEmail
            ? `Draft email opened with ${travellerEmail} prefilled.`
            : 'Draft email opened with the receipt attached.',
        );
      }
      logReceiptEvent({
        event: 'receipt_email_started',
        metadata: { intentId, source: 'receipt' },
      });
    } catch (error: any) {
      const message = error?.message ?? 'Ace could not open email right now.';
      setExportNote(message);
      logReceiptEvent({
        event: 'receipt_email_failed',
        severity: 'warning',
        message,
        metadata: { intentId, source: 'receipt' },
      });
    } finally {
      setExportAction(null);
    }
  };

  const handleDone = () => {
    reset();
    router.replace('/(main)/converse');
  };

  const handleAddToWallet = async () => {
    if (!walletPassUrl) return;
    try {
      await Linking.openURL(walletPassUrl);
      const openedAt = new Date().toISOString();
      setJourneySession((current) => current ? { ...current, walletPassUrl, walletLastOpenedAt: openedAt, updatedAt: openedAt } : current);
      await patchJourneySession(intentId, {
        walletPassUrl,
        walletLastOpenedAt: openedAt,
        updatedAt: openedAt,
      }).catch(() => null);
      logReceiptEvent({
        event: 'wallet_opened',
        metadata: { intentId, source: 'receipt' },
      });
      setWalletNote('Pass opened in Wallet.');
    } catch (error: any) {
      logReceiptEvent({
        event: 'wallet_open_failed',
        severity: 'warning',
        message: error?.message ?? 'Wallet failed to open from Receipt.',
        metadata: { intentId, source: 'receipt' },
      });
      setWalletNote('Could not open Wallet. Use the ticket code below.');
    }
  };

  const handleProactiveCardPress = async (card: ProactiveCard) => {
    if (card.kind === 'destination_suggestion' && (toStation || destination)) {
      const target = encodeURIComponent((toStation ?? destination)!);
      const citymapperUrl = `citymapper://directions?endname=${target}&endaddress=${target}`;
      const mapsUrl = `https://maps.google.com/?q=${target}`;
      try {
        const canOpen = await Linking.canOpenURL(citymapperUrl);
        await Linking.openURL(canOpen ? citymapperUrl : mapsUrl);
      } catch {
        await Linking.openURL(mapsUrl);
      }
      logReceiptEvent({
        event: 'journey_navigation_opened',
        metadata: { intentId, source: 'receipt', cardKind: card.kind },
      });
      return;
    }

    if (card.kind === 'leave_now' && (toStation || destination)) {
      const target = encodeURIComponent((toStation ?? destination)!);
      await Linking.openURL(`https://maps.google.com/?q=${target}`);
      logReceiptEvent({
        event: 'journey_navigation_opened',
        metadata: { intentId, source: 'receipt', cardKind: card.kind },
      });
      return;
    }

      if (['delay_risk', 'connection_risk'].includes(card.kind)) {
        const routePrompt = liveReroutePrompt;
        if (routePrompt) {
          logReceiptEvent({
            event: 'reroute_offer_accepted',
            metadata: { intentId, source: 'receipt', cardKind: card.kind },
          });
          router.replace({ pathname: '/(main)/converse', params: { prefill: routePrompt } } as any);
        }
        return;
      }

    if (['platform_changed', 'gate_changed'].includes(card.kind)) {
      logReceiptEvent({
        event: 'journey_signal_acknowledged',
        metadata: { intentId, source: 'receipt', cardKind: card.kind },
      });
      return;
    }
  };

  const openPendingPayment = async () => {
    if (!intentId || !paymentRequired || payLoading) return;
    const amount = fiatAmountNum ?? receipt?.amount ?? null;
    if (!amount) return;
    setPayLoading(true);
    setPaymentRecoveryNote('Complete payment, then return here. Ace will keep watching the booking.');
    logReceiptEvent({
      event: 'payment_recovery_opened',
      metadata: { intentId, currencyCode: fiatCode ?? 'GBP' },
    });
    try {
      if ((fiatCode ?? 'GBP').toUpperCase() === 'INR') {
        const { shortUrl } = await createUpiPaymentLink({
          jobId: intentId,
          amountInr: Math.round(amount),
          description: [fromStation, toStation].filter(Boolean).join(' → ') || 'Ace booking',
        });
        await Linking.openURL(shortUrl);
      } else {
        const { url } = await createCheckoutSession({
          jobId: intentId,
          amountFiat: amount,
          currencyCode: fiatCode ?? 'GBP',
          description: [fromStation, toStation].filter(Boolean).join(' → ') || 'Ace booking',
        });
        await Linking.openURL(url);
      }
    } catch (e: any) {
      const message = e?.message ?? 'Could not reopen payment right now.';
      setPaymentRecoveryNote(message);
      setError(message);
    } finally {
      setPayLoading(false);
    }
  };

  const refreshPendingPayment = async () => {
    if (!intentId || paymentCheckLoading) return;
    setPaymentCheckLoading(true);
    try {
      const [status, execution] = await Promise.all([
        getIntentStatus(intentId),
        getConciergeExecution(intentId).catch(() => null),
      ]);
      const nextQuoteExpiresAt = status.metadata?.quoteExpiresAt ?? status.metadata?.expiresAt ?? null;
      const nextPaymentConfirmedAt = status.metadata?.paymentConfirmedAt ?? null;
      const nextDispatchStartedAt = status.metadata?.openclawDispatchedAt ?? null;
      const nextPendingFulfilment =
        typeof status.metadata?.pendingFulfilment === 'boolean' ? status.metadata.pendingFulfilment : null;
      const nextFulfilmentFailed = status.metadata?.fulfilmentFailed === true;
      const serverTrip = parseTripContext(status.metadata?.tripContext);
      if (serverTrip) {
        setTripContext(serverTrip);
      }
      setJourneySession((current) => current ? {
        ...current,
        intentStatus: status.status ?? current.intentStatus ?? null,
        quoteExpiresAt: nextQuoteExpiresAt ?? current.quoteExpiresAt ?? null,
        paymentConfirmedAt: nextPaymentConfirmedAt ?? current.paymentConfirmedAt ?? null,
        openclawDispatchedAt: nextDispatchStartedAt ?? current.openclawDispatchedAt ?? null,
        pendingFulfilment: nextPendingFulfilment ?? current.pendingFulfilment ?? null,
        fulfilmentFailed: nextFulfilmentFailed ? true : current.fulfilmentFailed ?? null,
        executionStatus: execution?.status ?? current.executionStatus ?? null,
        recoveryBucket: execution?.recoveryBucket ?? current.recoveryBucket ?? null,
        recoveryAction: execution?.recommendedAction ?? current.recoveryAction ?? null,
        recoveryReason: execution?.recoveryReason ?? current.recoveryReason ?? null,
        executionSummary: execution?.summary ?? current.executionSummary ?? null,
        manualReviewRequired:
          typeof execution?.manualReviewRequired === 'boolean'
            ? execution.manualReviewRequired
            : current.manualReviewRequired ?? null,
        rerouteOfferActionLabel: execution?.rerouteOfferActionLabel ?? current.rerouteOfferActionLabel ?? null,
        tripContext: serverTrip ?? current.tripContext ?? null,
        updatedAt: new Date().toISOString(),
      } : current);
      await patchJourneySession(intentId, {
        intentStatus: status.status ?? null,
        quoteExpiresAt: nextQuoteExpiresAt,
        paymentConfirmedAt: nextPaymentConfirmedAt,
        openclawDispatchedAt: nextDispatchStartedAt,
        pendingFulfilment: nextPendingFulfilment,
        ...(execution?.status ? { executionStatus: execution.status } : {}),
        ...(execution?.recoveryBucket ? { recoveryBucket: execution.recoveryBucket } : {}),
        ...(execution?.recommendedAction ? { recoveryAction: execution.recommendedAction } : {}),
        ...(execution?.recoveryReason ? { recoveryReason: execution.recoveryReason } : {}),
        ...(execution?.summary ? { executionSummary: execution.summary } : {}),
        ...(typeof execution?.manualReviewRequired === 'boolean' ? { manualReviewRequired: execution.manualReviewRequired } : {}),
        ...(execution?.rerouteOfferActionLabel ? { rerouteOfferActionLabel: execution.rerouteOfferActionLabel } : {}),
        ...(nextFulfilmentFailed ? { fulfilmentFailed: true } : {}),
        ...(serverTrip ? { tripContext: serverTrip } : {}),
        updatedAt: new Date().toISOString(),
      }).catch(() => null);
      if (paymentConfirmedFromMetadata(status.metadata)) {
        const refreshedReceipt = await getReceipt(intentId);
        setReceipt(refreshedReceipt);
        setError(null);
        setPaymentRecoveryNote('Payment cleared. Ace has the journey locked in.');
        if (serverTrip) {
          setTripContext(syncTripBookingState(serverTrip, {
            phase: 'booked',
            bookingConfirmed: true,
            paymentConfirmed: true,
            paymentRequired,
            bookingRef: bookingRef ?? undefined,
            origin: fromStation ?? undefined,
            destination: toStation ?? undefined,
            departureTime: departureDatetime ?? departureTime ?? undefined,
            arrivalTime: arrivalTime ?? undefined,
            operator: operator ?? undefined,
            finalLegSummary: preservedFinalLegSummary ?? undefined,
          }));
        }
        return;
      }
      setPaymentRecoveryNote('Payment has not cleared yet. If you already paid, give it a moment and check again.');
    } catch (e: any) {
      setPaymentRecoveryNote(e?.message ?? 'Ace could not confirm payment yet. Please try again in a moment.');
    } finally {
      setPaymentCheckLoading(false);
    }
  };

  const handleReportIssue = async () => {
    if (!issueText.trim() || issueSending) return;
    setIssueSending(true);
    try {
      await reportIssue({
        intentId: intentId ?? '',
        bookingRef: bookingRef ?? null,
        description: issueText.trim(),
        hirerId: agentId ?? '',
      });
      await patchJourneySession(intentId ?? '', {
        supportState: 'requested',
        supportRequestedAt: new Date().toISOString(),
        supportSummary: issueText.trim() || 'Support requested from receipt.',
        lastEventKey: 'support_requested',
        lastEventAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).catch(() => null);
      setIssueSent(true);
      setIssueText('');
    } catch {
      // silently fail — issue logged on retry
    } finally {
      setIssueSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ReceiptAtmosphere />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color="#4b5563" />
        </Pressable>

        {loading && <ActivityIndicator color="#6366f1" style={{ marginTop: 80 }} />}

        {error && !hasJourneyDetails && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Cancellation banner — shown when notification tap carries action=cancelled */}
        {isCancelled && (
          <View style={styles.cancelBanner}>
            <Ionicons name="warning" size={18} color="#fbbf24" />
            <View style={{ flex: 1 }}>
              <Text style={styles.cancelBannerTitle}>This {modeMeta.noun} was cancelled</Text>
              <Text style={styles.cancelBannerBody}>Ask Ace for the next available option on this route.</Text>
            </View>
            <Pressable
              style={styles.cancelBannerBtn}
              onPress={() => {
                const query = liveReroutePrompt ?? undefined;
                router.replace({ pathname: '/(main)/converse', params: query ? { prefill: query } : undefined } as any);
              }}
            >
              <Text style={styles.cancelBannerBtnText}>{liveRerouteActionLabel}</Text>
            </Pressable>
          </View>
        )}

        {hasPlatformChanged && (
          <View style={[styles.cancelBanner, styles.infoBanner]}>
            <Ionicons name="train" size={18} color="#38bdf8" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cancelBannerTitle, styles.infoBannerTitle]}>Platform updated</Text>
              <Text style={[styles.cancelBannerBody, styles.infoBannerBody]}>
                {(disruptionRoute ?? (fromStation && toStation ? `${fromStation} → ${toStation}` : 'Your journey'))}
                {notifiedPlatform ? ` is now boarding from Platform ${notifiedPlatform}.` : ' has a new platform assignment.'}
              </Text>
            </View>
          </View>
        )}

        {isDelayed && (
          <View style={[styles.cancelBanner, styles.delayBanner]}>
            <Ionicons name="time" size={18} color="#f59e0b" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cancelBannerTitle, styles.delayBannerTitle]}>Service delayed</Text>
              <Text style={[styles.cancelBannerBody, styles.delayBannerBody]}>
                {(disruptionRoute ?? (fromStation && toStation ? `${fromStation} → ${toStation}` : 'Your journey'))}
                {delayMinutes ? ` is running ${delayMinutes} min late.` : ' is running late.'}
                {transcript ? ' Ace can line up the next option.' : ' Keep this screen handy for live updates.'}
              </Text>
            </View>
              {recoveryPrompt && (
                <Pressable
                  style={[styles.cancelBannerBtn, styles.delayBannerBtn]}
                  onPress={() => {
                    router.replace({ pathname: '/(main)/converse', params: { prefill: recoveryPrompt } } as any);
                  }}
                >
                  <Text style={[styles.cancelBannerBtnText, styles.delayBannerBtnText]}>
                    {transcript ? 'Rebook' : 'Find next option'}
                  </Text>
                </Pressable>
              )}
          </View>
        )}

        {hasGateUpdated && (
          <View style={[styles.cancelBanner, styles.infoBanner]}>
            <Ionicons name="airplane" size={18} color="#38bdf8" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cancelBannerTitle, styles.infoBannerTitle]}>Gate updated</Text>
              <Text style={[styles.cancelBannerBody, styles.infoBannerBody]}>
                {(disruptionRoute ?? (fromStation && toStation ? `${fromStation} → ${toStation}` : 'Your flight'))}
                {notifiedGate ? ` is now departing from Gate ${notifiedGate}.` : ' has a new gate assignment.'}
              </Text>
            </View>
          </View>
        )}

        {hasArrived && (
          <View style={styles.cancelBanner}>
            <Ionicons name="navigate-circle" size={18} color="#38bdf8" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cancelBannerTitle, { color: '#38bdf8' }]}>You&apos;ve arrived</Text>
              <Text style={[styles.cancelBannerBody, { color: '#7dd3fc' }]}>
                {preservedFinalLegSummary ?? (destination ? `${destination} is next. Open navigation?` : 'Ace can guide the final stretch from here.')}
              </Text>
            </View>
            {(toStation || destination) && (
              <Pressable
                style={[styles.cancelBannerBtn, { backgroundColor: '#082f49' }]}
                onPress={async () => {
                  const target = encodeURIComponent((toStation ?? destination)!);
                  const citymapperUrl = `citymapper://directions?endname=${target}&endaddress=${target}`;
                  const mapsUrl = `https://maps.google.com/?q=${target}`;
                  try {
                    const canOpen = await Linking.canOpenURL(citymapperUrl);
                    await Linking.openURL(canOpen ? citymapperUrl : mapsUrl);
                  } catch {
                    await Linking.openURL(mapsUrl);
                  }
                }}
              >
                <Text style={[styles.cancelBannerBtnText, { color: '#38bdf8' }]}>Navigate</Text>
              </Pressable>
            )}
          </View>
        )}

        {(hasHotelCheckInSoon || hasHotelCheckoutSoon) && (
          <View style={[styles.cancelBanner, hasHotelCheckInSoon ? styles.hotelBanner : styles.delayBanner]}>
            <Ionicons
              name={hasHotelCheckInSoon ? 'bed-outline' : 'exit-outline'}
              size={18}
              color={hasHotelCheckInSoon ? '#c084fc' : '#fbbf24'}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.cancelBannerTitle,
                  hasHotelCheckInSoon ? styles.hotelBannerTitle : styles.delayBannerTitle,
                ]}
              >
                {hasHotelCheckInSoon ? 'Hotel check-in coming up' : 'Hotel checkout coming up'}
              </Text>
              <Text
                style={[
                  styles.cancelBannerBody,
                  hasHotelCheckInSoon ? styles.hotelBannerBody : styles.delayBannerBody,
                ]}
              >
                {hasHotelCheckInSoon
                  ? hotelDetails?.bestOption
                    ? `${hotelDetails.bestOption.name} in ${hotelDetails.city} is coming up soon.`
                    : 'Your hotel stay is coming up soon.'
                  : hotelDetails?.bestOption
                  ? `${hotelDetails.bestOption.name} checkout is getting close.`
                  : 'Your hotel checkout is getting close.'}
              </Text>
            </View>
            {partnerCheckoutUrl && hasHotelCheckInSoon && (
              <Pressable
                style={[styles.cancelBannerBtn, styles.hotelBannerBtn]}
                onPress={() => { void Linking.openURL(partnerCheckoutUrl); }}
              >
                <Text style={[styles.cancelBannerBtnText, styles.hotelBannerBtnText]}>Open</Text>
              </Pressable>
            )}
          </View>
        )}

        {((receipt && !loading) || (!loading && hasJourneyDetails)) && (
          <>
            <Text style={styles.receiptEyebrow}>Journey</Text>
            {/* Success badge */}
            <View style={styles.badge}>
              <LinearGradient colors={['#052e16', '#14532d']} style={styles.badgeGrad}>
                <Ionicons name="checkmark" size={36} color="#4ade80" />
              </LinearGradient>
            </View>

            <Text style={styles.amount}>
              {(() => {
                const isEstimatedDisplay = (() => {
                  try {
                    const td = (tripContext?.legs && tripContext.legs[0] && (tripContext.legs[0] as any).trainDetails) || null;
                    if (td && td.dataSource === 'estimated') return true;
                    if (journeySession?.quoteExpiresAt && !receipt?.verifiedAt) return true;
                    return false;
                  } catch {
                    return false;
                  }
                })();
                const base = fiatAmountNum != null
                  ? formatMoney(fiatAmountNum, fiatSymbol, fiatCode)
                  : receipt
                  ? `${fiatSymbol}${receipt.amount}`
                  : 'Journey details';
                return isEstimatedDisplay ? `${base} (estimated)` : base;
              })()}
            </Text>
            <Text style={styles.subtitle}>
              {fromStation && toStation
                ? `${fromStation} → ${toStation}`
                : receipt
                ? 'Your trip, all together'
                : 'Journey details ready'}
            </Text>

            {cards.length > 0 && (
              <View style={styles.proactiveWrap}>
                {cards.slice(0, 2).map((card) => (
                  <ProactiveReceiptCard
                    key={card.id}
                    card={card}
                    actionLabel={proactiveCardActionLabel(card, liveJourneySession.rerouteOfferActionLabel)}
                    onPress={() => { void handleProactiveCardPress(card); }}
                  />
                ))}
              </View>
            )}

            {/* Receipt card */}
            <View style={styles.card}>
              <Row label="Status" value={receiptStatusLabel} pill />
              {receipt?.verifiedAt && (
                <Row label="Processed" value={new Date(receipt.verifiedAt).toLocaleString()} />
              )}
              {bookingState === 'payment_pending' && (
                <View style={styles.paymentRecoveryCard}>
                  <View style={styles.paymentRecoveryHeader}>
                    <Ionicons name="card-outline" size={15} color="#93c5fd" />
                    <Text style={styles.paymentRecoveryTitle}>{recoveryState.headline}</Text>
                  </View>
                  <Text style={styles.paymentRecoveryBody}>
                    {recoveryState.trustLine}
                  </Text>
                  <Text style={styles.paymentRecoveryNote}>{paymentRecoveryNote ?? recoveryState.etaLine}</Text>
                  <View style={styles.paymentRecoveryActions}>
                    <Pressable onPress={() => { void openPendingPayment(); }} style={styles.paymentRecoveryPrimary}>
                      <Text style={styles.paymentRecoveryPrimaryText}>
                        {payLoading ? 'Opening…' : 'Open payment'}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => { void refreshPendingPayment(); }} style={styles.paymentRecoverySecondary}>
                      <Text style={styles.paymentRecoverySecondaryText}>
                        {paymentCheckLoading ? 'Checking…' : 'I already paid'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {rolledBackJourney && (
                <View style={styles.paymentRecoveryCard}>
                  <View style={styles.paymentRecoveryHeader}>
                    <Ionicons name="shield-checkmark-outline" size={15} color="#93c5fd" />
                    <Text style={styles.paymentRecoveryTitle}>Ace stopped this safely</Text>
                  </View>
                  <Text style={styles.paymentRecoveryBody}>
                    One leg of this journey could not be secured, so Ace cancelled the rest to avoid leaving you half-booked.
                  </Text>
                  <Text style={styles.paymentRecoveryNote}>
                    Nothing here is being treated as confirmed. Ask Ace for the next best route and it will rebuild the trip cleanly.
                  </Text>
                </View>
              )}
              {error && (
                <Text style={styles.localNotice}>
                  Live receipt lookup is unavailable right now. Ace is still showing the journey details it already has for this trip.
                </Text>
              )}
            </View>

            {/* Journey Details + QR — multi-leg timeline or single-leg card */}
            {isMultiLegJourney ? (
              <JourneyTimeline
                title={tripContext?.title ?? `${tripLegs.length}-leg journey`}
                legs={tripLegs}
                bookingRef={bookingRef ?? tripContext?.bookingRef ?? undefined}
                onShowTicket={bookingRef ? () => setShowTicket(true) : undefined}
                qrLoading={qrLoading}
              />
            ) : hasJourneyDetails ? (
              <View style={styles.journeyCard}>
                <View style={styles.journeyHeader}>
                  <Text style={styles.journeyIcon}>{legModeIcon(tripContext?.mode ?? 'rail')}</Text>
                  <Text style={styles.journeyTitle}>{modeMeta.title}</Text>
                </View>

                {bookingRef && (
                  <View style={styles.journeyRefWrap}>
                    <Text style={styles.journeyRefLabel}>Reference</Text>
                    <Text style={styles.journeyRef}>{bookingRef}</Text>
                  </View>
                )}

                {fromStation && toStation && (
                  <Row label="Route" value={`${fromStation} → ${toStation}`} />
                )}
                {departureTime && (
                  <View style={rowStyles.row}>
                    <Text style={rowStyles.label}>Departs</Text>
                    <View style={styles.departureMeta}>
                      <Text style={rowStyles.value}>{departureTime}</Text>
                      {weather && (
                        <View style={styles.weatherPill}>
                          <Text style={styles.weatherPillText}>
                            {`${Math.round(weather.tempC)}°C · ${weather.description}`}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}
                {platform      && <Row label="Platform" value={platform} />}
                {operator      && <Row label="Operator" value={operator} />}
                {preservedFinalLegSummary && <Row label="Next step" value={preservedFinalLegSummary} />}

                {/* Show Ticket button — full-screen QR */}
                {bookingRef && (
                  <Pressable
                    onPress={() => setShowTicket(true)}
                    style={styles.showTicketBtn}
                  >
                    {qrLoading ? (
                      <ActivityIndicator color="#4ade80" size="small" />
                    ) : (
                      <Ionicons name="qr-code-outline" size={18} color="#4ade80" />
                    )}
                    <Text style={styles.showTicketText}>Open ticket code</Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {/* ✈ Flight card — shown only when there is no train leg alongside it */}
            {flightDetails && !hasJourneyDetails && (
              <View style={[styles.journeyCard, { marginTop: 12 }]}>
                <View style={styles.journeyHeader}>
                  <Text style={styles.journeyIcon}>✈️</Text>
                  <Text style={styles.journeyTitle}>Flight details</Text>
                </View>
                {flightDetails.pnr && (
                  <View style={styles.journeyRefWrap}>
                    <Text style={styles.journeyRefLabel}>PNR / Booking Reference</Text>
                    <Text style={styles.journeyRef}>{flightDetails.pnr}</Text>
                  </View>
                )}
                <Row label="Route"    value={`${flightDetails.origin} → ${flightDetails.destination}`} />
                <Row label="Flight"   value={`${flightDetails.carrier} ${flightDetails.flightNumber}`} />
                <Row label="Departs"  value={new Date(flightDetails.departureAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
                <Row label="Arrives"  value={new Date(flightDetails.arrivalAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
                <Row label="Stops"    value={flightDetails.stops === 0 ? 'Direct' : `${flightDetails.stops} stop${flightDetails.stops > 1 ? 's' : ''}`} />
                <Row label="Class"    value={flightDetails.cabinClass.replace(/_/g, ' ')} />
                {flightDetails.isReturn && (
                  <Row label="Type" value="Return" />
                )}
                <View style={styles.flightCompletionCard}>
                  <Text style={styles.flightCompletionTitle}>Flight completion</Text>
                  {flightCompletionRows(flightDetails).map((item) => (
                    <View key={`${item.label}-${item.value}`} style={styles.flightCompletionRow}>
                      <Ionicons
                        name={item.tone === 'ready' ? 'checkmark-circle' : 'time-outline'}
                        size={15}
                        color={item.tone === 'ready' ? '#4ade80' : '#f59e0b'}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.flightCompletionLabel}>{item.label}</Text>
                        <Text style={styles.flightCompletionBody}>{item.value}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* 🏨 Hotel card — shown when a hotel booking exists */}
            {hotelDetails?.bestOption && (
              <View style={[styles.journeyCard, { marginTop: 12 }]}>
                <View style={styles.journeyHeader}>
                  <Text style={styles.journeyIcon}>🏨</Text>
                  <Text style={styles.journeyTitle}>{hotelDetails.bestOption.name}</Text>
                </View>
                <View style={{ flexDirection: 'row', marginBottom: 4, gap: 2 }}>
                  {'★'.repeat(Math.min(hotelDetails.bestOption.stars, 5)).split('').map((s, i) => (
                    <Text key={i} style={{ color: '#f59e0b', fontSize: 12 }}>{s}</Text>
                  ))}
                </View>
                <Row label="City"      value={hotelDetails.city} />
                <Row label="Check-in"  value={hotelDetails.checkIn} />
                <Row label="Check-out" value={hotelDetails.checkOut} />
                <Row label="Rate"      value={`${hotelDetails.bestOption.currency} ${hotelDetails.bestOption.ratePerNight}/night`} />
                <Row label="Total"     value={`${hotelDetails.bestOption.currency} ${hotelDetails.bestOption.totalCost}`} />
                {hotelDetails.bestOption.area && (
                  <Row label="Area" value={hotelDetails.bestOption.area} />
                )}
                {partnerCheckoutUrl && (
                  <Pressable
                    onPress={() => { void Linking.openURL(partnerCheckoutUrl); }}
                    style={styles.shareBtn}
                  >
                    <Ionicons name="open-outline" size={18} color="#4ade80" />
                    <Text style={[styles.shareBtnText, { color: '#4ade80' }]}>Open hotel checkout</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Actions */}
              <View style={styles.exportCard}>
                <Text style={styles.exportCardTitle}>Expense-ready receipt</Text>
                <Text style={styles.exportCardBody}>
                  Export a PDF or open an email draft with route, timing, traveller, fare, and booking reference details.
                </Text>
              </View>

              <Pressable onPress={() => { void handleExportPdf(); }} style={styles.shareBtn} disabled={!!exportAction}>
                {exportAction === 'pdf' ? (
                  <ActivityIndicator color="#cbe8ff" size="small" />
                ) : (
                  <Ionicons name="document-text-outline" size={18} color="#cbe8ff" />
                )}
                <Text style={[styles.shareBtnText, styles.exportPrimaryText]}>
                  {exportAction === 'pdf' ? 'Preparing PDF...' : 'Export PDF'}
                </Text>
              </Pressable>

              <Pressable onPress={() => { void handleEmailReceipt(); }} style={styles.shareBtn} disabled={!!exportAction}>
                {exportAction === 'email' ? (
                  <ActivityIndicator color="#93c5fd" size="small" />
                ) : (
                  <Ionicons name="mail-outline" size={18} color="#93c5fd" />
                )}
                <Text style={[styles.shareBtnText, styles.exportSecondaryText]}>
                  {exportAction === 'email' ? 'Opening email...' : 'Email receipt'}
                </Text>
              </Pressable>

              {exportNote && (
                <Text style={styles.exportNote}>{exportNote}</Text>
              )}

              <Pressable onPress={handleShare} style={styles.shareBtn} disabled={!!exportAction}>
                <Ionicons name="share-outline" size={18} color="#818cf8" />
                <Text style={styles.shareBtnText}>Share journey</Text>
              </Pressable>

              {repeatRoutePrompt && (
                <Pressable
                  onPress={() => router.replace({ pathname: '/(main)/converse', params: { prefill: repeatRoutePrompt } } as any)}
                  style={styles.shareBtn}
                >
                  <Ionicons name="refresh-outline" size={18} color="#93c5fd" />
                  <Text style={[styles.shareBtnText, { color: '#93c5fd' }]}>Run this with Ace again</Text>
                </Pressable>
              )}

              {shareToken && (
                <Pressable
                onPress={async () => {
                  const url = `https://api.agentpay.so/trip/view/${shareToken}`;
                  await Share.share({
                    title: 'Join my trip on Ace',
                    message: `Track this journey live -> ${url}`,
                    url,
                  });
                }}
                style={styles.shareBtn}
              >
                <Ionicons name="people-outline" size={18} color="#4ade80" />
                <Text style={[styles.shareBtnText, { color: '#4ade80' }]}>Share live tracking</Text>
              </Pressable>
            )}

            {walletPassUrl && (
              <Pressable onPress={() => { void handleAddToWallet(); }} style={styles.shareBtn}>
                <Ionicons name="wallet-outline" size={18} color="#cbe8ff" />
                <Text style={[styles.shareBtnText, { color: '#cbe8ff' }]}>
                  {journeySession?.walletLastOpenedAt ? 'Open Wallet' : 'Add pass to Wallet'}
                </Text>
              </Pressable>
            )}

            {walletNote && (
              <Text style={styles.walletNote}>{walletNote}</Text>
            )}

            <Pressable onPress={() => setShowIssue(true)} style={styles.issueBtn}>
              <Ionicons name="alert-circle-outline" size={15} color="#6b7280" />
              <Text style={styles.issueBtnText}>
                {liveJourneySession.supportState === 'requested'
                  ? 'Update support'
                  : liveJourneySession.manualReviewRequired
                  ? 'Add detail'
                  : 'Report an issue'}
              </Text>
            </Pressable>

            <Pressable onPress={handleDone} style={styles.doneBtn}>
              <Text style={styles.doneBtnText}>Ask Ace for another trip</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* ── Full-screen ticket QR modal ─────────────────────────────────── */}
      <Modal
        visible={showTicket}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowTicket(false)}
      >
        <View style={ticketStyles.container}>
          <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>

            <Text style={ticketStyles.label}>SHOW THIS IF ASKED</Text>

            {/* QR code */}
            {qrLocalUri ? (
              <View style={ticketStyles.qrWrap}>
                <Image
                  source={{ uri: qrLocalUri }}
                  style={{ width: QR_SIZE, height: QR_SIZE }}
                  resizeMode="contain"
                />
              </View>
            ) : (
              <View style={[ticketStyles.qrWrap, { alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator color="#111" size="large" />
              </View>
            )}

            {/* Booking ref */}
            {bookingRef && (
              <Text style={ticketStyles.ref}>{bookingRef}</Text>
            )}

            {/* Route */}
            {fromStation && toStation && (
              <Text style={ticketStyles.route}>{fromStation} → {toStation}</Text>
            )}
            {departureTime && (
              <Text style={ticketStyles.time}>Departs {departureTime}</Text>
            )}
            {platform && (
              <Text style={ticketStyles.platform}>Platform {platform}</Text>
            )}

            <Pressable onPress={() => setShowTicket(false)} style={ticketStyles.closeBtn} hitSlop={16}>
              <Text style={ticketStyles.closeText}>Back to details</Text>
            </Pressable>

          </SafeAreaView>
        </View>
      </Modal>

      {/* ── Issue report modal ──────────────────────────────────────── */}
      <Modal
        visible={showIssue}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowIssue(false)}
      >
        <View style={issueStyles.container}>
          <View style={issueStyles.handle} />
          <Text style={issueStyles.title}>Something wrong?</Text>
          <Text style={issueStyles.subtitle}>
            {liveJourneySession.manualReviewRequired
              ? 'Ace already attached the live trip. Add any extra detail support should see.'
              : 'Tell us what happened. We already have your trip details.'}
          </Text>
          {issueSent ? (
            <View style={issueStyles.sentBox}>
              <Ionicons name="checkmark-circle" size={32} color="#4ade80" />
              <Text style={issueStyles.sentText}>Got it — we'll look into this.</Text>
              <Pressable onPress={() => { setShowIssue(false); setIssueSent(false); }} style={issueStyles.closeBtn}>
                <Text style={issueStyles.closeBtnText}>Close</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={issueStyles.input}
                placeholder="e.g. Wrong platform, booking not confirmed…"
                placeholderTextColor="#4b5563"
                multiline
                numberOfLines={4}
                value={issueText}
                onChangeText={setIssueText}
                autoFocus
              />
              <Pressable
                onPress={handleReportIssue}
                style={[issueStyles.submitBtn, (!issueText.trim() || issueSending) && issueStyles.submitBtnDisabled]}
                disabled={!issueText.trim() || issueSending}
              >
                {issueSending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={issueStyles.submitBtnText}>Send report</Text>
                }
              </Pressable>
              <Pressable onPress={() => setShowIssue(false)} style={issueStyles.cancelBtn}>
                <Text style={issueStyles.cancelBtnText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ReceiptAtmosphere() {
  return (
    <View pointerEvents="none" style={styles.atmosphere}>
      <LinearGradient
        colors={['rgba(16, 185, 129, 0.12)', 'rgba(16, 185, 129, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.atmosphereGlowLeft}
      />
      <LinearGradient
        colors={['rgba(56, 189, 248, 0.1)', 'rgba(99, 102, 241, 0.02)', 'rgba(99, 102, 241, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.atmosphereGlowRight}
      />
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function JourneyTimeline({
  title,
  legs,
  bookingRef,
  onShowTicket,
  qrLoading,
}: {
  title: string;
  legs: TripContext['legs'];
  bookingRef?: string;
  onShowTicket?: () => void;
  qrLoading: boolean;
}) {
  return (
    <View style={styles.journeyCard}>
      <View style={styles.journeyHeader}>
        <Text style={styles.journeyIcon}>🗺️</Text>
        <Text style={styles.journeyTitle}>{title}</Text>
      </View>

      {bookingRef && (
        <View style={styles.journeyRefWrap}>
          <Text style={styles.journeyRefLabel}>Reference</Text>
          <Text style={styles.journeyRef}>{bookingRef}</Text>
        </View>
      )}

      {legs.map((leg, index) => {
        const dep = formatLegMoment(leg.departureTime);
        const arr = formatLegMoment(leg.arrivalTime);
        const label = leg.label ?? leg.operator ?? `Leg ${index + 1}`;
        return (
          <View key={leg.id ?? `${leg.mode}-${index}`} style={timelineStyles.leg}>
            <Text style={timelineStyles.legIcon}>{legModeIcon(leg.mode)}</Text>
            <View style={timelineStyles.legBody}>
              <Text style={timelineStyles.legHeader}>{`Leg ${index + 1} · ${label}`}</Text>
              {(leg.origin || leg.destination) && (
                <Text style={timelineStyles.legRoute}>
                  {leg.origin ?? 'Origin'} → {leg.destination ?? 'Destination'}
                </Text>
              )}
              {(dep || arr) && (
                <Text style={timelineStyles.legMeta}>
                  {dep ? `Dep ${dep}` : 'Departure TBD'}
                  {arr ? ` · Arr ${arr}` : ''}
                </Text>
              )}
              {leg.bookingRef && (
                <Text style={timelineStyles.legPnr}>{leg.bookingRef}</Text>
              )}
            </View>
            <View style={[timelineStyles.statusDot, leg.status === 'completed' || leg.status === 'booked'
              ? timelineStyles.statusDone
              : leg.status === 'attention'
              ? timelineStyles.statusWarn
              : timelineStyles.statusActive]} />
          </View>
        );
      })}

      {/* Show Ticket */}
      {onShowTicket && (
        <Pressable onPress={onShowTicket} style={styles.showTicketBtn}>
          {qrLoading ? (
            <ActivityIndicator color="#4ade80" size="small" />
          ) : (
            <Ionicons name="qr-code-outline" size={18} color="#4ade80" />
          )}
          <Text style={styles.showTicketText}>Open ticket code</Text>
        </Pressable>
      )}
    </View>
  );
}

const timelineStyles = StyleSheet.create({
  leg: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  legIcon: {
    fontSize: 18,
    marginTop: 1,
    width: 24,
    textAlign: 'center',
  },
  legBody: {
    flex: 1,
    gap: 2,
  },
  legHeader: {
    fontSize: 13,
    color: '#d1d5db',
    fontWeight: '600',
  },
  legRoute: {
    fontSize: 12,
    color: '#6b7280',
  },
  legMeta: {
    fontSize: 11,
    color: '#94a3b8',
  },
  legPnr: {
    fontSize: 11,
    color: '#4ade80',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  statusDone: {
    backgroundColor: '#4ade80',
  },
  statusWarn: {
    backgroundColor: '#f59e0b',
  },
  statusActive: {
    backgroundColor: '#60a5fa',
  },
});

function shortId(id: string) {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function Row({
  label, value, mono, pill,
}: {
  label: string; value: string; mono?: boolean; pill?: boolean;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      {pill ? (
        <View style={rowStyles.pill}>
          <Text style={rowStyles.pillText}>{value}</Text>
        </View>
      ) : (
        <Text style={[rowStyles.value, mono && rowStyles.mono]} numberOfLines={1}>
          {value}
        </Text>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const rowStyles = StyleSheet.create({
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label:    { fontSize: 13, color: '#6b7280' },
  value:    { fontSize: 13, color: '#d1d5db', maxWidth: '55%', textAlign: 'right' },
  mono:     { fontFamily: 'monospace', fontSize: 11 },
  pill:     { backgroundColor: '#052e16', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  pillText: { fontSize: 12, color: '#4ade80', fontWeight: '600' },
});

function proactiveCardActionLabel(card: ProactiveCard, rerouteActionLabel?: string | null): string | null {
  switch (card.kind) {
    case 'delay_risk':
    case 'connection_risk':
      return rerouteActionLabel ?? 'Find alternatives';
    case 'platform_changed':
    case 'gate_changed':
      return 'Got it';
    case 'destination_suggestion':
      return 'Open map';
    case 'leave_now':
      return 'Navigate';
    default:
      return card.ctaLabel ?? null;
  }
}

function ProactiveReceiptCard({
  card,
  actionLabel,
  onPress,
}: {
  card: ProactiveCard;
  actionLabel?: string | null;
  onPress?: () => void;
}) {
  const accent = card.severity === 'warning' ? '#f59e0b' : card.severity === 'success' ? '#4ade80' : '#60a5fa';
  return (
    <View style={[styles.proactiveCard, { borderColor: `${accent}33` }]}>
      <View style={[styles.proactiveDot, { backgroundColor: accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.proactiveTitle}>{card.title}</Text>
        <Text style={styles.proactiveBody}>{card.body}</Text>
        {actionLabel && onPress && (
          <Pressable onPress={onPress} style={styles.proactiveActionBtn}>
            <Text style={styles.proactiveActionText}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#080808' },
  atmosphere: {
    ...StyleSheet.absoluteFillObject,
  },
  atmosphereGlowLeft: {
    position: 'absolute',
    top: -50,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 170,
  },
  atmosphereGlowRight: {
    position: 'absolute',
    top: 140,
    right: -120,
    width: 320,
    height: 320,
    borderRadius: 180,
  },
  container: { padding: 24, alignItems: 'center', paddingBottom: 60 },
  back:      { alignSelf: 'flex-start', marginBottom: 32 },

  cancelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#451a03',
    borderWidth: 1,
    borderColor: '#92400e',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 8,
  },
  cancelBannerTitle: { fontSize: 14, fontWeight: '700', color: '#fbbf24', marginBottom: 2 },
  cancelBannerBody:  { fontSize: 12, color: '#d97706', lineHeight: 17 },
  cancelBannerBtn: {
    backgroundColor: '#78350f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelBannerBtnText: { fontSize: 13, fontWeight: '700', color: '#fbbf24' },
  infoBanner: {
    backgroundColor: '#082f49',
    borderColor: '#0c4a6e',
  },
  infoBannerTitle: {
    color: '#38bdf8',
  },
  infoBannerBody: {
    color: '#7dd3fc',
  },
  delayBanner: {
    backgroundColor: '#451a03',
    borderColor: '#b45309',
  },
  delayBannerTitle: {
    color: '#f59e0b',
  },
  delayBannerBody: {
    color: '#fdba74',
  },
  delayBannerBtn: {
    backgroundColor: '#78350f',
  },
  delayBannerBtnText: {
    color: '#fbbf24',
  },
  hotelBanner: {
    backgroundColor: '#2e1065',
    borderColor: '#6d28d9',
  },
  hotelBannerTitle: {
    color: '#c084fc',
  },
  hotelBannerBody: {
    color: '#ddd6fe',
  },
  hotelBannerBtn: {
    backgroundColor: '#4c1d95',
  },
  hotelBannerBtnText: {
    color: '#e9d5ff',
  },

  badge: {
    marginBottom: 20,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 10,
  },
  badgeGrad: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptEyebrow: {
    fontSize: 11,
    color: '#d8e6f5',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 12,
  },

  amount:   { fontSize: 40, fontWeight: '800', color: '#f9fafb', letterSpacing: -1.2, marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#94a3b8', marginBottom: 32, lineHeight: 21, textAlign: 'center' },
  proactiveWrap: { width: '100%', gap: 10, marginBottom: 14 },
  proactiveCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  proactiveDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  proactiveTitle: { fontSize: 12, color: '#f9fafb', fontWeight: '700', marginBottom: 2 },
  proactiveBody: { fontSize: 12, color: '#94a3b8', lineHeight: 17 },
  proactiveActionBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#0b1320',
    borderWidth: 1,
    borderColor: '#1e3a5f',
  },
  proactiveActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#cbe8ff',
  },
  walletNote: {
    marginTop: 10,
    fontSize: 12,
    color: '#7f95aa',
    textAlign: 'center',
  },
  exportCard: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.18)',
    backgroundColor: 'rgba(8, 16, 30, 0.78)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  exportCardTitle: {
    fontSize: 13,
    color: '#e6f1fb',
    fontWeight: '700',
    marginBottom: 4,
  },
  exportCardBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#8ea3b8',
  },
  exportPrimaryText: {
    color: '#cbe8ff',
  },
  exportSecondaryText: {
    color: '#93c5fd',
  },
  exportNote: {
    marginTop: 2,
    marginBottom: 10,
    fontSize: 12,
    color: '#8ea3b8',
    textAlign: 'center',
  },

  card: {
    width: '100%',
    backgroundColor: 'rgba(13, 13, 13, 0.88)',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.28)',
    marginBottom: 14,
  },
  localNotice: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
  },
  paymentRecoveryCard: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    backgroundColor: 'rgba(8, 15, 28, 0.82)',
    padding: 14,
    gap: 10,
  },
  paymentRecoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  paymentRecoveryTitle: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#93c5fd',
    fontWeight: '700',
  },
  paymentRecoveryBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#cbd5e1',
  },
  paymentRecoveryNote: {
    fontSize: 12,
    lineHeight: 18,
    color: '#94a3b8',
  },
  paymentRecoveryActions: {
    gap: 8,
  },
  paymentRecoveryPrimary: {
    borderRadius: 12,
    backgroundColor: '#1d4ed8',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentRecoveryPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#eff6ff',
  },
  paymentRecoverySecondary: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentRecoverySecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#cbd5e1',
  },

  journeyCard: {
    width: '100%',
    backgroundColor: 'rgba(8, 18, 34, 0.94)',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.34)',
    marginBottom: 14,
  },
  journeyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  journeyIcon:  { fontSize: 18 },
  journeyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#dcecff',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  journeyRefWrap: {
    alignItems: 'center',
    backgroundColor: '#0b1320',
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.24)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  journeyRefLabel: {
    fontSize: 10,
    color: '#4b5563',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  journeyRef: {
    fontSize: 22,
    fontWeight: '700',
    color: '#dcecff',
    letterSpacing: 2.5,
    fontFamily: 'monospace',
  },
  flightCompletionCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
    backgroundColor: 'rgba(8, 15, 28, 0.58)',
    padding: 12,
    gap: 10,
  },
  flightCompletionTitle: {
    fontSize: 12,
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  flightCompletionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  flightCompletionLabel: {
    fontSize: 12,
    color: '#e5e7eb',
    fontWeight: '700',
    marginBottom: 2,
  },
  flightCompletionBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#94a3b8',
  },
  departureMeta: {
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: '60%',
  },
  weatherPill: {
    backgroundColor: '#0b1320',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  weatherPillText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },

  showTicketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    backgroundColor: '#0b1320',
    borderRadius: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 122, 0.28)',
  },
  showTicketText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#dcecff',
    letterSpacing: 0.3,
  },

  sigCard: {
    width: '100%',
    backgroundColor: '#050f07',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#14532d',
    marginBottom: 28,
  },
  sigHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sigLabel: {
    fontSize: 11,
    color: '#22c55e',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sigValue: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#4ade80',
    lineHeight: 16,
  },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(67, 56, 202, 0.35)',
    borderRadius: 18,
    paddingHorizontal: 28,
    paddingVertical: 15,
    marginBottom: 10,
    width: '100%',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 10, 26, 0.65)',
  },
  shareBtnText: { fontSize: 15, fontWeight: '600', color: '#818cf8' },

  doneBtn:     { width: '100%', alignItems: 'center', paddingVertical: 16 },
  doneBtnText: { fontSize: 14, color: '#94a3b8', letterSpacing: 0.2 },

  issueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginBottom: 4,
  },
  issueBtnText: {
    fontSize: 13,
    color: '#94a3b8',
  },

  errorBox:  { marginTop: 60, padding: 20 },
  errorText: { fontSize: 14, color: '#f87171', textAlign: 'center', lineHeight: 21 },
});

// ── Full-screen ticket styles ─────────────────────────────────────────────────

const ticketStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6b7280',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 24,
  },
  qrWrap: {
    width: QR_SIZE + 24,
    height: QR_SIZE + 24,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 24,
  },
  ref: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111',
    letterSpacing: 3,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  route: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '600',
    marginBottom: 4,
  },
  time: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  platform: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 32,
  },
  closeBtn: {
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  closeText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '600',
  },
});

const issueStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    padding: 24,
    paddingTop: 16,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2d2d2d',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f9fafb',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#f9fafb',
    borderWidth: 1,
    borderColor: '#262626',
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  submitBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelBtnText: {
    fontSize: 14,
    color: '#4b5563',
  },
  sentBox: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 16,
  },
  sentText: {
    fontSize: 16,
    color: '#d1d5db',
    textAlign: 'center',
  },
  closeBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  closeBtnText: {
    fontSize: 15,
    color: '#9ca3af',
    fontWeight: '600',
  },
});
