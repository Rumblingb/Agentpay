/**
 * notifications.ts — local departure reminders
 *
 * Schedules two local notifications per booked journey:
 *   - T-60 min: "1 hour to go"
 *   - T-15 min: "Time to go!"
 *
 * All client-side — no server push needed for v1.
 */

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function notifId(intentId: string, tag: string): string {
  return `bro_${intentId}_${tag}`;
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

export async function scheduleJourneyNotifications(
  intentId: string,
  departureISO: string,
  route: string,
  platform: string | null,
): Promise<void> {
  const departure = parseDeparture(departureISO);
  if (!departure) return;
  const platformSuffix = platform ? ` · Platform ${platform}` : '';
  const now = Date.now();

  const t60secs = Math.floor((departure.getTime() - 60 * 60 * 1000 - now) / 1000);
  if (t60secs > 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: notifId(intentId, '60min'),
      content: {
        title: '🚂 1 hour to go',
        body: `${route}${platformSuffix}`,
        data: { intentId },
      },
      trigger: { seconds: t60secs },
    });
  }

  const t15secs = Math.floor((departure.getTime() - 15 * 60 * 1000 - now) / 1000);
  if (t15secs > 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: notifId(intentId, '15min'),
      content: {
        title: '🏃 Time to go!',
        body: `${route} · 15 minutes${platformSuffix}`,
        data: { intentId },
      },
      trigger: { seconds: t15secs },
    });
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
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, '60min')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, '15min')),
  ]);
}
