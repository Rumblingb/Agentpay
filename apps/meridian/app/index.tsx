/**
 * Root index — boot screen
 *
 * Loads credentials from SecureStore + prefs from AsyncStorage.
 * Routes to:
 *   /onboard   — first launch or missing credentials
 *   /(main)/converse  — returning user
 */

import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { loadCredentials, loadPrefs, loadHistory } from '../lib/storage';
import { useStore } from '../lib/store';

export default function BootScreen() {
  const { hydrate } = useStore();

  useEffect(() => {
    (async () => {
      try {
        const [creds, prefs, history] = await Promise.all([
          loadCredentials(),
          loadPrefs(),
          loadHistory(),
        ]);

        if (!creds || !prefs.onboarded) {
          router.replace('/onboard');
          return;
        }

        hydrate({
          agentId:              creds.agentId,
          agentKey:             creds.agentKey,
          userName:             prefs.userName,
          autoConfirmLimitUsdc: prefs.autoConfirmLimitUsdc,
          onboarded:            prefs.onboarded,
          turns:                history,
          homeStation:          prefs.homeStation,
          workStation:          prefs.workStation,
        });

        router.replace('/(main)/converse');
      } catch {
        router.replace('/onboard');
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#6366f1" size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
