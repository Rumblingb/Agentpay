/**
 * Settings screen — name, auto-confirm limit, reset
 */

import React, { useState, useEffect } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../lib/store';
import { savePrefs, clearCredentials, clearHistory } from '../../lib/storage';
import { hasProfile, deleteProfile } from '../../lib/profile';

export default function SettingsScreen() {
  const { userName, autoConfirmLimitUsdc, agentId, setPrefs, reset } = useStore();
  const [name, setName]           = useState(userName);
  const [budget, setBudget]       = useState(String(autoConfirmLimitUsdc));
  const [saved, setSaved]         = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    hasProfile().then(setProfileSaved).catch(() => setProfileSaved(false));
  }, []);

  const handleSave = async () => {
    const budgetN = parseFloat(budget) || 5;
    const newName = name.trim() || 'there';
    setPrefs({ userName: newName, autoConfirmLimitUsdc: budgetN });
    await savePrefs({ userName: newName, autoConfirmLimitUsdc: budgetN });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    Alert.alert(
      'Reset Meridian',
      'This will clear your agent identity, history, and all credentials. You will need to set up again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await Promise.all([clearCredentials(), clearHistory()]);
            reset();
            router.replace('/onboard');
          },
        },
      ],
    );
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear History',
      'Clear all conversation history? Your agent identity will be preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearHistory();
            reset();
            router.back();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color="#6b7280" />
          </Pressable>
          <Text style={styles.title}>Settings</Text>
          <Pressable onPress={handleSave} hitSlop={12}>
            <Text style={[styles.saveBtn, saved && styles.saveBtnDone]}>
              {saved ? 'Saved ✓' : 'Save'}
            </Text>
          </Pressable>
        </View>

        {/* Name */}
        <Section label="YOUR NAME">
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#374151"
            autoCapitalize="words"
          />
        </Section>

        {/* Auto-confirm budget */}
        <Section
          label="AUTO-APPROVE LIMIT (USDC)"
          hint="I'll hire agents automatically up to this amount. I'll ask for confirmation above it."
        >
          <View style={styles.budgetRow}>
            {['2', '5', '10', '25'].map((v) => (
              <Pressable
                key={v}
                onPress={() => setBudget(v)}
                style={[styles.chip, budget === v && styles.chipActive]}
              >
                <Text style={[styles.chipText, budget === v && styles.chipTextActive]}>${v}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        {/* Agent identity */}
        {agentId && (
          <Section label="YOUR AGENT IDENTITY">
            <View style={styles.identityRow}>
              <Ionicons name="person-circle-outline" size={16} color="#4b5563" />
              <Text style={styles.identityText} numberOfLines={1}>{agentId}</Text>
            </View>
          </Section>
        )}

        {/* Travel Profile */}
        <Section
          label="TRAVEL PROFILE"
          hint="Stored locally on your device. Shared only when you confirm a booking with Face ID."
        >
          <View style={styles.profileRow}>
            <Ionicons
              name={profileSaved ? 'shield-checkmark' : 'shield-outline'}
              size={16}
              color={profileSaved ? '#34d399' : '#4b5563'}
            />
            <Text style={[styles.profileStatus, profileSaved && styles.profileStatusSaved]}>
              {profileSaved ? 'Profile saved — biometric protected' : 'No profile saved'}
            </Text>
          </View>
          <View style={styles.profileActions}>
            <Pressable
              onPress={() => router.push('/onboard?step=profile')}
              style={styles.profileBtn}
            >
              <Ionicons name="create-outline" size={15} color="#818cf8" />
              <Text style={styles.profileBtnText}>
                {profileSaved ? 'Edit profile' : 'Set up profile'}
              </Text>
            </Pressable>
            {profileSaved && (
              <Pressable
                onPress={() => {
                  Alert.alert(
                    'Delete Travel Profile',
                    'This will permanently remove your profile from this device.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          await deleteProfile();
                          setProfileSaved(false);
                        },
                      },
                    ],
                  );
                }}
                style={[styles.profileBtn, styles.profileBtnDanger]}
              >
                <Ionicons name="trash-outline" size={15} color="#f87171" />
                <Text style={[styles.profileBtnText, { color: '#f87171' }]}>Delete profile</Text>
              </Pressable>
            )}
          </View>
        </Section>

        {/* Danger zone */}
        <Section label="DATA">
          <Pressable onPress={handleClearHistory} style={styles.dangerRow}>
            <Ionicons name="trash-outline" size={16} color="#6b7280" />
            <Text style={styles.dangerText}>Clear conversation history</Text>
          </Pressable>
          <Pressable onPress={handleReset} style={[styles.dangerRow, { marginTop: 8 }]}>
            <Ionicons name="refresh-outline" size={16} color="#ef4444" />
            <Text style={[styles.dangerText, { color: '#ef4444' }]}>Reset Meridian</Text>
          </Pressable>
        </Section>

        {/* Footer */}
        <Text style={styles.footer}>
          Meridian 1.0{'\n'}
          Powered by AgentPay · agentpay.so
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <View style={secStyles.wrap}>
      <Text style={secStyles.label}>{label}</Text>
      {hint && <Text style={secStyles.hint}>{hint}</Text>}
      {children}
    </View>
  );
}

const secStyles = StyleSheet.create({
  wrap:  { marginBottom: 28 },
  label: { fontSize: 11, fontWeight: '700', color: '#4b5563', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  hint:  { fontSize: 12, color: '#374151', marginBottom: 10, lineHeight: 17 },
});

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#080808' },
  container: { padding: 24 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  title:       { fontSize: 18, fontWeight: '700', color: '#f9fafb' },
  saveBtn:     { fontSize: 15, fontWeight: '600', color: '#818cf8' },
  saveBtnDone: { color: '#4ade80' },

  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#f9fafb',
  },

  budgetRow: { flexDirection: 'row', gap: 10 },
  chip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
  },
  chipActive: { backgroundColor: '#1e1b4b', borderColor: '#4338ca' },
  chipText:   { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  chipTextActive: { color: '#818cf8' },

  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 12,
  },
  identityText: { flex: 1, fontSize: 12, fontFamily: 'monospace', color: '#4b5563' },

  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  profileStatus: { fontSize: 13, color: '#4b5563' },
  profileStatusSaved: { color: '#34d399' },
  profileActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  profileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  profileBtnDanger: { borderColor: '#7f1d1d' },
  profileBtnText: { fontSize: 13, fontWeight: '600', color: '#818cf8' },

  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#111',
  },
  dangerText: { fontSize: 14, color: '#6b7280' },

  footer: {
    fontSize: 11,
    color: '#1f2937',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});
