import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { STRIPE_PUBLISHABLE_KEY } from '../lib/constants';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StripeProvider
        publishableKey={STRIPE_PUBLISHABLE_KEY}
        {...(Platform.OS === 'ios' ? { merchantIdentifier: 'merchant.so.agentpay.meridian' } : {})}
        googlePay={{ merchantCountryCode: 'GB', currencyCode: 'gbp', testEnv: !STRIPE_PUBLISHABLE_KEY.startsWith('pk_live') }}
      >
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#080808' },
            animation: 'slide_from_right',
          }}
        />
      </StripeProvider>
    </GestureHandlerRootView>
  );
}
