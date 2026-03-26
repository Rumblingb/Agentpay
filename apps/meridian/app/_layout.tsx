import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.screen === 'converse' && data?.action === 'rebook' && data?.transcript) {
        // Cancellation rebook — open Bro with pre-filled transcript
        router.push({ pathname: '/(main)/converse', params: { prefill: data.transcript } });
      } else if (data?.intentId && data?.screen === 'receipt') {
        const params: Record<string, string> = { intentId: data.intentId };
        if (data?.action === 'cancelled') params.cancelled = 'true';
        if (data?.action === 'arrival') params.arrived = 'true';
        if (data?.action === 'platform_changed') params.platformChanged = 'true';
        if (data?.action === 'delay') params.delayed = 'true';
        if (data?.action === 'gate_changed' || data?.action === 'gate_assigned') params.gateUpdated = 'true';
        if (data?.destination) params.destination = data.destination;
        if (data?.finalLegSummary) params.finalLegSummary = data.finalLegSummary;
        if (data?.shareToken) params.shareToken = data.shareToken;
        if (data?.platform) params.notifiedPlatform = String(data.platform);
        if (data?.delayMinutes != null) params.delayMinutes = String(data.delayMinutes);
        if (data?.gate) params.notifiedGate = String(data.gate);
        if (data?.disruptionRoute) params.disruptionRoute = String(data.disruptionRoute);
        if (data?.transcript) params.transcript = String(data.transcript);
        router.push({ pathname: '/(main)/receipt/[intentId]', params });
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
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
