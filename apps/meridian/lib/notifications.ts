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

export async function scheduleJourneyNotifications(
  intentId: string,
  departureISO: string,
  route: string,
  platform: string | null,
): Promise<void> {
  const departure = new Date(departureISO);
  if (isNaN(departure.getTime())) return;
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

export async function cancelJourneyNotifications(intentId: string): Promise<void> {
  await Promise.allSettled([
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, '60min')),
    Notifications.cancelScheduledNotificationAsync(notifId(intentId, '15min')),
  ]);
}
