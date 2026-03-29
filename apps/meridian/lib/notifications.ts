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
        title: 'Bro · 30 minutes to go',
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
        title: 'Bro · 10 minutes to go',
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
            ? `${options.finalLegSummary} Tap to open Bro.`
            : `${destination} is next. Tap to open Bro navigation.`,
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
        title: 'Bro · Hotel tomorrow',
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
        title: 'Bro · Hotel check-in soon',
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
          title: 'Bro · Checkout tomorrow',
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
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'hotel-24h')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'hotel-2h')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, 'hotel-checkout')),
  ]);
}
