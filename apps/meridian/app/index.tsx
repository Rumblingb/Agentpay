/**
 * Root index — boot screen
 *
 * Loads credentials from SecureStore + prefs from AsyncStorage.
 * Routes to:
 *   /onboard   — first launch or missing credentials
 *   /(main)/converse  — returning user
 */

import { useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { router } from 'expo-router';
import { loadCredentials, loadPrefs, loadHistory, loadActiveTrip, loadCurrentJourneySession } from '../lib/storage';
import { shouldPreferJourney } from '../lib/journeyRouting';
import { useStore } from '../lib/store';

export default function BootScreen() {
  const { hydrate } = useStore();

  useEffect(() => {
    (async () => {
      try {
        const [creds, prefs, history, activeTrip, liveJourney] = await Promise.all([
          loadCredentials(),
          loadPrefs(),
          loadHistory(),
          loadActiveTrip(),
          loadCurrentJourneySession(),
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

        if (liveJourney && shouldPreferJourney(liveJourney)) {
          router.replace({ pathname: '/(main)/journey/[intentId]', params: { intentId: liveJourney.intentId } });
          return;
        }

        router.replace('/(main)/converse');
      } catch {
        router.replace('/onboard');
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.iconMark}>
        <Image
          source={require('../assets/ace-mark.png')}
          style={styles.iconImage}
          resizeMode="contain"
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
    width: 136,
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
    shadowColor: '#c7e7ff',
    shadowOpacity: 0.2,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 0 },
  },
  iconImage: {
    width: 136,
    height: 128,
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
