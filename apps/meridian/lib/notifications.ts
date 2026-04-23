/**
 * notifications.ts — local departure reminders
 *
 * Schedules companion notifications per booked journey:
 *   - T-30 min: "30 minutes to go"
 *   - T-10 min: "10 minutes to go"
 *   - Arrival: "You've arrived"
 *
 * All client-side — no server push needed for v1.
 */

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { loadConsents } from './profile';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const consents = await loadConsents().catch(() => null);
  if (consents && !consents.notificationsConsented) {
    return false;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function notifId(intentId: string, tag: string): string {
  return `bro_${intentId}_${tag}`;
}

function routeNotifId(routeKey: string, tag: string): string {
  return `bro_route_${routeKey}_${tag}`;
}

function parseMoment(s: string): Date | null {
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 15, 0, 0);
  }

  return parseDeparture(s);
}

/**
 * Parses departure time. Accepts:
 *   - Full ISO string ("2026-03-24T17:42:00")   ← preferred, passed when travelDate is available
 *   - HH:MM only ("17:42")                       ← Darwin fallback; assumed today, bumped to tomorrow if past
 */
function parseDeparture(s: string): Date | null {
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;

  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (hhmm) {
    const now = new Date();
    const d = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      parseInt(hhmm[1], 10), parseInt(hhmm[2], 10),
    );
    if (d.getTime() < now.getTime() - 60_000) d.setDate(d.getDate() + 1);
    return d;
  }
  return null;
}

function formatWhen(d: Date): string {
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scheduleAt(date: Date): { type: Notifications.SchedulableTriggerInputTypes.DATE; date: Date } | null {
  if (date.getTime() <= Date.now()) return null;
  return { type: Notifications.SchedulableTriggerInputTypes.DATE, date };
}

export async function scheduleJourneyNotifications(
  intentId: string,
  departureISO: string,
  route: string,
  platform: string | null,
  options?: {
    arrivalISO?: string | null;
    destination?: string | null;
    finalLegSummary?: string | null;
    shareToken?: string | null;
  },
): Promise<void> {
  const departure = parseDeparture(departureISO);
  if (!departure) return;
  const platformSuffix = platform ? ` · Platform ${platform}` : '';
  const now = Date.now();

  const t30secs = Math.floor((departure.getTime() - 30 * 60 * 1000 - now) / 1000);
  if (t30secs > 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: notifId(intentId, '30min'),
      content: {
        title: 'Ace · 30 minutes to go',
        body: `${route}${platformSuffix}`,
        data: {
          intentId,
          screen: 'receipt',
          action: 'departure_companion',
          shareToken: options?.shareToken ?? undefined,
        },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: t30secs },
    });
  }

  const t10secs = Math.floor((departure.getTime() - 10 * 60 * 1000 - now) / 1000);
  if (t10secs > 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: notifId(intentId, '10min'),
      content: {
        title: 'Ace · 10 minutes to go',
        body: `${route}${platformSuffix ? `${platformSuffix}` : ''}`,
        data: {
          intentId,
          screen: 'receipt',
          action: 'departure_companion',
          shareToken: options?.shareToken ?? undefined,
        },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: t10secs },
    });
  }

  const arrival = options?.arrivalISO ? parseDeparture(options.arrivalISO) : null;
  const destination = options?.destination?.trim();
  if (arrival && destination) {
    const arrivalSecs = Math.floor((arrival.getTime() - now) / 1000);
    if (arrivalSecs > 0) {
      await Notifications.scheduleNotificationAsync({
        identifier: notifId(intentId, 'arrival'),
        content: {
          title: `You've arrived in ${destination}`,
          body: options?.finalLegSummary
            ? `${options.finalLegSummary} Tap to open Ace.`
            : `${destination} is next. Tap to open Ace navigation.`,
          data: {
            intentId,
            screen: 'receipt',
            action: 'arrival',
            destination,
            finalLegSummary: options?.finalLegSummary ?? undefined,
            shareToken: options?.shareToken ?? undefined,
          },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: arrivalSecs },
      });
    }
  }
}

export async function scheduleTravelDayNudge(params: {
  intentId: string;
  departureISO: string;
  route: string;
  platform?: string | null;
  shareToken?: string | null;
}): Promise<void> {
  const departure = parseDeparture(params.departureISO);
  if (!departure) return;
  const nudgeTime = new Date(departure);
  nudgeTime.setHours(7, 0, 0, 0);
  const trigger = scheduleAt(nudgeTime);
  if (!trigger) return;

  const platformSuffix = params.platform ? ` Platform ${params.platform}.` : '';
  await Notifications.scheduleNotificationAsync({
    identifier: notifId(params.intentId, 'travel-day'),
    content: {
      title: 'Good morning. Ace has your journey.',
      body: `${params.route}.${platformSuffix} Need anything before you go?`,
      data: {
        intentId: params.intentId,
        screen: 'receipt',
        action: 'travel_day',
        shareToken: params.shareToken ?? undefined,
      },
    },
    trigger,
  });
}

export async function scheduleProactiveRouteReminder(params: {
  routeKey: string;
  route: string;
  origin?: string | null;
  destination?: string | null;
  count: number;
  typicalFareGbp?: number | null;
  weekday: number;
  minutesOfDay?: number | null;
}): Promise<void> {
  if (params.count < 3) return;

  const now = new Date();
  const target = new Date(now);
  const delta = (params.weekday - now.getDay() + 7) % 7 || 7;
  target.setDate(now.getDate() + delta);
  if (params.minutesOfDay != null) {
    target.setHours(Math.floor(params.minutesOfDay / 60), params.minutesOfDay % 60, 0, 0);
  } else {
    target.setHours(8, 0, 0, 0);
  }

  const nudge = new Date(target);
  nudge.setDate(target.getDate() - 1);
  nudge.setHours(21, 0, 0, 0);
  const trigger = scheduleAt(nudge);
  if (!trigger) return;

  const timeLabel = params.minutesOfDay != null
    ? `${String(Math.floor(params.minutesOfDay / 60)).padStart(2, '0')}:${String(params.minutesOfDay % 60).padStart(2, '0')}`
    : null;
  const routeLabel = params.destination
    ? `your usual ${params.destination} run`
    : params.route;
  const fare = typeof params.typicalFareGbp === 'number'
    ? `, around GBP ${params.typicalFareGbp.toFixed(2)}`
    : '';
  const body = timeLabel
    ? `Tomorrow's ${routeLabel}. I found the ${timeLabel}${fare}. Want me to book it?`
    : `Tomorrow's ${routeLabel}. Want Ace to line it up for you?`;
  const transcript = timeLabel
    ? `${params.route} tomorrow at ${timeLabel}`
    : `${params.route} tomorrow`;

  await Notifications.scheduleNotificationAsync({
    identifier: routeNotifId(params.routeKey, 'proactive'),
    content: {
      title: "Tomorrow's your usual route",
      body,
      data: {
        routeKey: params.routeKey,
        screen: 'converse',
        action: 'proactive_route',
        route: params.route,
        transcript,
      },
    },
    trigger,
  });
}

export async function scheduleProactiveRerouteReminder(params: {
  intentId: string;
  route: string;
  reason: string;
  transcript?: string | null;
  shareToken?: string | null;
  offerTitle?: string | null;
  offerBody?: string | null;
  offerActionLabel?: string | null;
}): Promise<void> {
  const triggerAt = new Date(Date.now() + 12_000);
  const trigger = scheduleAt(triggerAt);
  if (!trigger) return;

  await Notifications.scheduleNotificationAsync({
    identifier: notifId(params.intentId, 'reroute'),
    content: {
      title: params.offerTitle ?? 'Ace found a stronger way through',
      body: params.offerBody ?? `${params.reason} Want Ace to line up the next best option?`,
      data: {
        intentId: params.intentId,
        screen: 'journey',
        action: 'proactive_reroute',
        route: params.route,
        transcript: params.transcript ?? `${params.route} next available`,
        shareToken: params.shareToken ?? undefined,
        rerouteTitle: params.offerTitle ?? undefined,
        rerouteBody: params.offerBody ?? undefined,
        rerouteActionLabel: params.offerActionLabel ?? undefined,
      },
    },
    trigger,
  });
}

export async function scheduleHotelNotifications(
  intentId: string,
  params: {
    hotelName: string;
    city: string;
    checkInISO: string;
    checkOutISO?: string | null;
    shareToken?: string | null;
    bookingUrl?: string | null;
  },
): Promise<void> {
  const checkIn = parseMoment(params.checkInISO);
  if (!checkIn) return;

  const now = Date.now();
  const checkIn24h = Math.floor((checkIn.getTime() - 24 * 60 * 60 * 1000 - now) / 1000);
  if (checkIn24h > 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: notifId(intentId, 'hotel-24h'),
      content: {
        title: 'Ace · Hotel tomorrow',
        body: `${params.hotelName} in ${params.city}. Check-in ${formatWhen(checkIn)}.`,
        data: {
          intentId,
          screen: 'receipt',
          action: 'hotel_checkin',
          hotelName: params.hotelName,
          city: params.city,
          bookingUrl: params.bookingUrl ?? undefined,
          shareToken: params.shareToken ?? undefined,
        },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: checkIn24h },
    });
  }

  const checkIn2h = Math.floor((checkIn.getTime() - 2 * 60 * 60 * 1000 - now) / 1000);
  if (checkIn2h > 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: notifId(intentId, 'hotel-2h'),
      content: {
        title: 'Ace · Hotel check-in soon',
        body: `${params.hotelName}. Keep your checkout link and ID ready.`,
        data: {
          intentId,
          screen: 'receipt',
          action: 'hotel_checkin',
          hotelName: params.hotelName,
          city: params.city,
          bookingUrl: params.bookingUrl ?? undefined,
          shareToken: params.shareToken ?? undefined,
        },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: checkIn2h },
    });
  }

  const checkOut = params.checkOutISO ? parseMoment(params.checkOutISO) : null;
  if (checkOut) {
    const checkout12h = Math.floor((checkOut.getTime() - 12 * 60 * 60 * 1000 - now) / 1000);
    if (checkout12h > 0) {
      await Notifications.scheduleNotificationAsync({
        identifier: notifId(intentId, 'hotel-checkout'),
        content: {
          title: 'Ace · Checkout tomorrow',
          body: `${params.hotelName} checkout is coming up. Review onward plans.`,
          data: {
            intentId,
            screen: 'receipt',
            action: 'hotel_checkout',
            hotelName: params.hotelName,
            city: params.city,
            bookingUrl: params.bookingUrl ?? undefined,
            shareToken: params.shareToken ?? undefined,
          },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: checkout12h },
      });
    }
  }
}

export async function getExpoPushToken(): Promise<string | null> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch {
    return null;
  }
}

export async function cancelJourneyNotifications(intentId: string): Promise<void> {
  await Promise.allSettled([
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, '30min')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, '10min')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'arrival')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'travel-day')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'reroute')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'hotel-24h')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'hotel-2h')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'hotel-checkout')),
  ]);
}
