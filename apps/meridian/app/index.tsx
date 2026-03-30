/**
 * Root index — boot screen
 *
 * Loads credentials from SecureStore + prefs from AsyncStorage.
 * Routes to:
 *   /onboard   — first launch or missing credentials
 *   /(main)/converse  — returning user
 */

import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { loadCredentials, loadPrefs, loadHistory, loadActiveTrip } from '../lib/storage';
import { useStore } from '../lib/store';

export default function BootScreen() {
  const { hydrate } = useStore();

  useEffect(() => {
    (async () => {
      try {
        const [creds, prefs, history, activeTrip] = await Promise.all([
          loadCredentials(),
          loadPrefs(),
          loadHistory(),
          loadActiveTrip(),
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
          turns:                activeTrip ? history : [],
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
      {/* Icon mark */}
      <View style={styles.iconMark}>
        <Text style={styles.iconLetter}>A</Text>
      </View>

      {/* Wordmark */}
      <Text style={styles.wordmark}>ACE</Text>
      <Text style={styles.tagline}>Travel, handled.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  iconMark: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    shadowColor: '#10b981',
    shadowOpacity: 0.5,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  iconLetter: {
    color: '#080808',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1,
  },
  wordmark: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 6,
    marginBottom: 10,
  },
  tagline: {
    color: '#475569',
    fontSize: 13,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
});
