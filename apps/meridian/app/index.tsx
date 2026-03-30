/**
 * Root index — boot screen
 *
 * Loads credentials from SecureStore + prefs from AsyncStorage.
 * Routes to:
 *   /onboard   — first launch or missing credentials
 *   /(main)/converse  — returning user
 */

import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
      <LinearGradient colors={['rgba(16,185,129,0.18)', 'rgba(0,0,0,0)']} style={styles.glow} />
      <View style={styles.mark}>
        <Text style={styles.wordmark}>ACE</Text>
        <Text style={styles.tagline}>Travel, handled</Text>
      </View>
      <ActivityIndicator color="#6ee7b7" size="small" />
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
  glow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  mark: {
    alignItems: 'center',
    marginBottom: 16,
  },
  wordmark: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 3,
  },
  tagline: {
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
});
