/**
 * Setup screen — collect agentId, agentKey, OpenAI key
 * In production: replace with OAuth / magic link flow.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../lib/store';

export default function SetupScreen() {
  const { setCredentials } = useStore();
  const [agentId,   setAgentId]   = useState('');
  const [agentKey,  setAgentKey]  = useState('');
  const [openaiKey, setOpenaiKey] = useState('');

  const handleStart = () => {
    if (!agentId.trim() || !agentKey.trim() || !openaiKey.trim()) {
      Alert.alert('Missing fields', 'All three fields are required to use Meridian.');
      return;
    }
    setCredentials(agentId.trim(), agentKey.trim(), openaiKey.trim());
    router.replace('/(main)/converse');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoWrap}>
          <LinearGradient colors={['#4338ca', '#6366f1']} style={styles.logoCircle}>
            <Ionicons name="mic" size={36} color="#fff" />
          </LinearGradient>
          <Text style={styles.logoTitle}>Meridian</Text>
          <Text style={styles.logoSub}>Voice-first agentic commerce</Text>
        </View>

        {/* Inputs */}
        <View style={styles.form}>
          <Label text="Agent ID" hint="From POST /api/v1/agents/register (agt_…)" />
          <Input
            value={agentId}
            onChangeText={setAgentId}
            placeholder="agt_a1b2c3d4"
            autoCapitalize="none"
          />

          <Label text="Agent Key" hint="Shown once at registration (agk_…)" />
          <Input
            value={agentKey}
            onChangeText={setAgentKey}
            placeholder="agk_…"
            autoCapitalize="none"
            secureTextEntry
          />

          <Label text="OpenAI API Key" hint="For Whisper speech-to-text" />
          <Input
            value={openaiKey}
            onChangeText={setOpenaiKey}
            placeholder="sk-…"
            autoCapitalize="none"
            secureTextEntry
          />
        </View>

        <Pressable onPress={handleStart} style={{ marginTop: 8 }}>
          <LinearGradient
            colors={['#4338ca', '#6366f1']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.startBtn}
          >
            <Ionicons name="mic" size={20} color="#fff" />
            <Text style={styles.startBtnText}>Start Meridian</Text>
          </LinearGradient>
        </Pressable>

        <Text style={styles.footer}>
          Payments secured by AgentPay · api.agentpay.so
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Label({ text, hint }: { text: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={labelStyles.label}>{text}</Text>
      {hint && <Text style={labelStyles.hint}>{hint}</Text>}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      style={inputStyles.input}
      placeholderTextColor="#374151"
      {...props}
    />
  );
}

const labelStyles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: '#9ca3af', marginBottom: 2 },
  hint:  { fontSize: 11, color: '#4b5563' },
});

const inputStyles = StyleSheet.create({
  input: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 10,
    padding: 13,
    fontSize: 14,
    color: '#f9fafb',
    marginBottom: 18,
    fontFamily: 'monospace',
  },
});

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#080808' },
  container: { padding: 28, paddingTop: 40 },
  logoWrap:  { alignItems: 'center', marginBottom: 40 },
  logoCircle:{
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 30, elevation: 12,
  },
  logoTitle: { fontSize: 30, fontWeight: '700', color: '#f9fafb', marginBottom: 6 },
  logoSub:   { fontSize: 14, color: '#6b7280' },
  form:      { marginBottom: 8 },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    padding: 16,
  },
  startBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  footer: {
    fontSize: 12,
    color: '#374151',
    textAlign: 'center',
    marginTop: 28,
  },
});
