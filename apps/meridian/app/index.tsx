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
import { AceMark } from '../components/AceMark';

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
      <View style={styles.iconMark}>
        <AceMark
          size={108}
          ringColor="rgba(226, 241, 255, 0.88)"
          glowColor="#c7e7ff"
          backgroundColor="#2b333d"
          iconColor="rgba(246, 249, 252, 0.98)"
        />
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
    width: 124,
    height: 124,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#c7e7ff',
    shadowOpacity: 0.18,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  wordmark: {
    color: '#f5f7fa',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 6,
    marginBottom: 10,
  },
  tagline: {
    color: '#7f8a98',
    fontSize: 13,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
});
