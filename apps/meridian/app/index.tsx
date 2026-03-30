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
      <LinearGradient colors={['#030712', '#07111f', '#05070b']} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(56,189,248,0.18)', 'rgba(15,23,42,0)']} style={styles.skyGlow} />
      <LinearGradient colors={['rgba(16,185,129,0.16)', 'rgba(5,7,11,0)']} style={styles.emeraldGlow} />

      <View style={styles.stage}>
        <View style={styles.sigillium}>
          <LinearGradient colors={['rgba(15,23,42,0.98)', 'rgba(6,10,18,0.98)']} style={styles.sigilliumCore}>
            <View style={styles.sigilliumRing}>
              <Text style={styles.sigilliumLetter}>A</Text>
            </View>
          </LinearGradient>
        </View>

        <View style={styles.mark}>
          <Text style={styles.wordmark}>ACE</Text>
          <Text style={styles.tagline}>Travel, handled with judgment.</Text>
        </View>

        <View style={styles.loadingRail}>
          <LinearGradient colors={['rgba(94,234,212,0.14)', 'rgba(125,211,252,0.7)', 'rgba(16,185,129,0.14)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.loadingFill} />
        </View>
        <Text style={styles.loadingCopy}>Preparing your live routes and travel memory</Text>
      </View>
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
  skyGlow: {
    position: 'absolute',
    top: 100,
    width: 360,
    height: 360,
    borderRadius: 180,
  },
  emeraldGlow: {
    position: 'absolute',
    bottom: 120,
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  stage: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  sigillium: {
    width: 148,
    height: 148,
    borderRadius: 74,
    padding: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    shadowColor: '#38bdf8',
    shadowOpacity: 0.24,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
    marginBottom: 28,
  },
  sigilliumCore: {
    flex: 1,
    borderRadius: 73,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sigilliumRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.34)',
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    alignItems: 'center',
    marginBottom: 26,
  },
  sigilliumLetter: {
    color: '#ecfeff',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 2,
  },
  wordmark: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 5,
  },
  tagline: {
    marginTop: 10,
    color: '#b6c2d1',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  loadingRail: {
    width: 168,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  loadingFill: {
    width: '72%',
    height: '100%',
    borderRadius: 999,
  },
  loadingCopy: {
    color: '#7b8aa0',
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
