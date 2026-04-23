import { useEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { trackClientEvent } from '../lib/telemetry';

export default function RootLayout() {
  const router = useRouter();
  const handledNotificationRef = useRef<string | null>(null);

  useEffect(() => {
    const handleNotificationResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const responseId = response.notification.request.identifier;
      if (handledNotificationRef.current === responseId) return;
      handledNotificationRef.current = responseId;
      const data = response.notification.request.content.data as any;
      void trackClientEvent({
        event: 'notification_opened',
        screen: 'root',
        metadata: {
          action: data?.action ?? null,
          screen: data?.screen ?? null,
          intentId: data?.intentId ? String(data.intentId) : null,
        },
      });
      if (data?.screen === 'converse' && data?.action === 'rebook' && data?.transcript) {
        // Cancellation rebook — open Ace with pre-filled transcript
        router.push({ pathname: '/(main)/converse', params: { prefill: data.transcript } });
      } else if (data?.action === 'proactive_route' && (data?.transcript || data?.route)) {
        router.push({ pathname: '/(main)/converse', params: { prefill: String(data.transcript ?? data.route) } });
      } else if (data?.action === 'proactive_reroute' && data?.intentId) {
        router.push({
          pathname: '/(main)/journey/[intentId]',
          params: {
            intentId: String(data.intentId),
            rerouteTranscript: data?.transcript ? String(data.transcript) : undefined,
            rerouteTitle: data?.rerouteTitle ? String(data.rerouteTitle) : undefined,
            rerouteBody: data?.rerouteBody ? String(data.rerouteBody) : undefined,
            rerouteActionLabel: data?.rerouteActionLabel ? String(data.rerouteActionLabel) : undefined,
          },
        });
      } else if (data?.action === 'proactive_reroute' && (data?.transcript || data?.route)) {
        router.push({ pathname: '/(main)/converse', params: { prefill: String(data.transcript ?? data.route) } });
      } else if (data?.action === 'travel_day' && data?.intentId) {
        router.push({ pathname: '/(main)/journey/[intentId]', params: { intentId: String(data.intentId) } });
      } else if (data?.intentId && data?.screen === 'receipt') {
        if (['delay', 'platform_changed', 'gate_changed', 'arrival'].includes(String(data?.action ?? ''))) {
          router.push({ pathname: '/(main)/journey/[intentId]', params: { intentId: String(data.intentId) } });
          return;
        }
        const params: Record<string, string> = { intentId: data.intentId };
        if (data?.action === 'cancelled') params.cancelled = 'true';
        if (data?.action === 'arrival') params.arrived = 'true';
        if (data?.action === 'platform_changed') params.platformChanged = 'true';
        if (data?.action === 'delay') params.delayed = 'true';
        if (data?.action === 'gate_changed' || data?.action === 'gate_assigned') params.gateUpdated = 'true';
        if (data?.action === 'hotel_checkin') params.hotelCheckInSoon = 'true';
        if (data?.action === 'hotel_checkout') params.hotelCheckoutSoon = 'true';
        if (data?.destination) params.destination = data.destination;
        if (data?.finalLegSummary) params.finalLegSummary = data.finalLegSummary;
        if (data?.shareToken) params.shareToken = data.shareToken;
        if (data?.platform) params.notifiedPlatform = String(data.platform);
        if (data?.delayMinutes != null) params.delayMinutes = String(data.delayMinutes);
        if (data?.gate) params.notifiedGate = String(data.gate);
        if (data?.disruptionRoute) params.disruptionRoute = String(data.disruptionRoute);
        if (data?.transcript) params.transcript = String(data.transcript);
        if (data?.bookingUrl) params.partnerCheckoutUrl = String(data.bookingUrl);
        router.push({ pathname: '/(main)/receipt/[intentId]', params });
      }
    };

    void Notifications.getLastNotificationResponseAsync().then(handleNotificationResponse).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar
        style="light"
        backgroundColor="#080808"
        translucent={false}
      />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#03070f' },
          animation: 'slide_from_right',
        }}
      />
    </GestureHandlerRootView>
  );
}
