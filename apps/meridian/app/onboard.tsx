/**
 * Onboard — premium first-launch experience
 *
 * Three steps:
 *   1. Welcome — intro to Meridian
 *   2. Name — "What should I call you?"
 *   3. Setup — OpenAI key + auto-confirm budget preference
 *
 * On completion: auto-registers user as AgentPay agent,
 * saves credentials to SecureStore, routes to converse.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { registerAgent } from '../lib/api';
import { saveCredentials, savePrefs } from '../lib/storage';
import { useStore } from '../lib/store';

type Step = 'welcome' | 'name' | 'setup';

export default function OnboardScreen() {
  const { hydrate } = useStore();
  const [step, setStep]         = useState<Step>('welcome');
  const [userName, setUserName] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [budget, setBudget]     = useState('5');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const fadeAnim                = useRef(new Animated.Value(1)).current;

  const fadeToNext = (next: Step) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setStep(next);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    });
  };

  const handleFinish = async () => {
    if (!openaiKey.trim()) {
      setError('OpenAI key is required for voice recognition.');
      return;
    }
    const budgetN = parseFloat(budget) || 5;
    const name = userName.trim() || 'Traveler';

    setLoading(true);
    setError(null);
    try {
      const { agentId, agentKey } = await registerAgent({ name });
      const creds = { agentId, agentKey, openaiKey: openaiKey.trim() };

      await Promise.all([
        saveCredentials(creds),
        savePrefs({ userName: name, autoConfirmLimitUsdc: budgetN, onboarded: true }),
      ]);

      hydrate({
        agentId,
        agentKey,
        openaiKey: openaiKey.trim(),
        userName: name,
        autoConfirmLimitUsdc: budgetN,
        onboarded: true,
        turns: [],
      });

      router.replace('/(main)/converse');
    } catch (e: any) {
      setError(e.message ?? 'Setup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.content, { opacity: fadeAnim }]}>

            {/* ── Step: Welcome ─────────────────────────────────────────── */}
            {step === 'welcome' && (
              <View style={styles.stepWrap}>
                <LinearGradient colors={['#1e1b4b', '#080808']} style={styles.heroBg} />

                <View style={styles.orbWrap}>
                  <LinearGradient
                    colors={['#4338ca', '#7c3aed']}
                    style={styles.orb}
                  >
                    <Ionicons name="mic" size={44} color="#fff" />
                  </LinearGradient>
                </View>

                <Text style={styles.heroTitle}>Meridian</Text>
                <Text style={styles.heroSub}>
                  Your personal AI concierge.{'\n'}
                  Speak. I handle the rest.
                </Text>

                <View style={styles.features}>
                  <Feature icon="airplane" text="Book flights and hotels by voice" />
                  <Feature icon="flash"    text="Agents hired and paid automatically" />
                  <Feature icon="shield-checkmark" text="Every payment verified on-chain" />
                </View>

                <Pressable onPress={() => fadeToNext('name')} style={styles.primaryBtn}>
                  <LinearGradient
                    colors={['#4338ca', '#6366f1']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.btnGrad}
                  >
                    <Text style={styles.btnText}>Get Started</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </LinearGradient>
                </Pressable>
              </View>
            )}

            {/* ── Step: Name ────────────────────────────────────────────── */}
            {step === 'name' && (
              <View style={styles.stepWrap}>
                <Text style={styles.stepTitle}>What should I call you?</Text>
                <Text style={styles.stepSub}>
                  I'll use your name when we talk.
                </Text>

                <TextInput
                  style={styles.input}
                  value={userName}
                  onChangeText={setUserName}
                  placeholder="Your name"
                  placeholderTextColor="#374151"
                  autoFocus
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => fadeToNext('setup')}
                />

                <Pressable
                  onPress={() => fadeToNext('setup')}
                  style={styles.primaryBtn}
                >
                  <LinearGradient
                    colors={['#4338ca', '#6366f1']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.btnGrad}
                  >
                    <Text style={styles.btnText}>
                      {userName.trim() ? `Nice to meet you, ${userName.trim()}` : 'Continue'}
                    </Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </LinearGradient>
                </Pressable>
              </View>
            )}

            {/* ── Step: Setup ───────────────────────────────────────────── */}
            {step === 'setup' && (
              <View style={styles.stepWrap}>
                <Text style={styles.stepTitle}>
                  One last thing{userName.trim() ? `, ${userName.trim()}` : ''}.
                </Text>
                <Text style={styles.stepSub}>
                  I need your OpenAI key for voice recognition.
                  Your key is stored securely on this device only.
                </Text>

                <FieldLabel text="OpenAI API Key" />
                <TextInput
                  style={styles.input}
                  value={openaiKey}
                  onChangeText={setOpenaiKey}
                  placeholder="sk-…"
                  placeholderTextColor="#374151"
                  autoCapitalize="none"
                  secureTextEntry
                  autoFocus
                />

                <FieldLabel
                  text="Auto-approve limit (USDC)"
                  hint="I'll hire agents automatically up to this amount. Above it, I'll ask first."
                />
                <View style={styles.budgetRow}>
                  {['2', '5', '10', '25'].map((v) => (
                    <Pressable
                      key={v}
                      onPress={() => setBudget(v)}
                      style={[styles.budgetChip, budget === v && styles.budgetChipActive]}
                    >
                      <Text style={[styles.budgetChipText, budget === v && styles.budgetChipTextActive]}>
                        ${v}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {error && <Text style={styles.error}>{error}</Text>}

                <Pressable
                  onPress={handleFinish}
                  style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={['#4338ca', '#6366f1']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.btnGrad}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="mic" size={20} color="#fff" />
                        <Text style={styles.btnText}>Launch Meridian</Text>
                      </>
                    )}
                  </LinearGradient>
                </Pressable>

                <Text style={styles.legal}>
                  Payments powered by AgentPay · api.agentpay.so{'\n'}
                  Your agent identity is created automatically.
                </Text>
              </View>
            )}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Feature({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={featStyles.row}>
      <View style={featStyles.iconWrap}>
        <Ionicons name={icon as any} size={18} color="#818cf8" />
      </View>
      <Text style={featStyles.text}>{text}</Text>
    </View>
  );
}

function FieldLabel({ text, hint }: { text: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={fieldStyles.label}>{text}</Text>
      {hint && <Text style={fieldStyles.hint}>{hint}</Text>}
    </View>
  );
}

const featStyles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconWrap:{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#1e1b4b', alignItems: 'center', justifyContent: 'center' },
  text:    { flex: 1, fontSize: 15, color: '#d1d5db', lineHeight: 21 },
});

const fieldStyles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: '#9ca3af', marginBottom: 4 },
  hint:  { fontSize: 12, color: '#4b5563', lineHeight: 17 },
});

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#080808' },
  scroll:  { flexGrow: 1 },
  content: { flex: 1 },

  stepWrap: {
    flex: 1,
    padding: 28,
    paddingTop: 32,
  },

  // Welcome hero
  heroBg: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.6,
  },
  orbWrap: {
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 20,
  },
  orb: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 40,
    elevation: 20,
  },
  heroTitle: {
    fontSize: 38,
    fontWeight: '800',
    color: '#f9fafb',
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: 12,
  },
  heroSub: {
    fontSize: 17,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 40,
  },
  features: {
    marginBottom: 40,
  },

  // Steps
  stepTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f9fafb',
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  stepSub: {
    fontSize: 15,
    color: '#6b7280',
    lineHeight: 22,
    marginBottom: 32,
  },

  // Input
  input: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    color: '#f9fafb',
    marginBottom: 24,
  },

  // Budget chips
  budgetRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 32,
  },
  budgetChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
  },
  budgetChipActive: {
    backgroundColor: '#1e1b4b',
    borderColor: '#4338ca',
  },
  budgetChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280',
  },
  budgetChipTextActive: {
    color: '#818cf8',
  },

  // Button
  primaryBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 16,
  },
  btnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  btnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },

  error: {
    fontSize: 13,
    color: '#f87171',
    marginBottom: 16,
    textAlign: 'center',
  },

  legal: {
    fontSize: 11,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 8,
  },
});
