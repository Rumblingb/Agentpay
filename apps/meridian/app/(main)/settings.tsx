/**
 * Settings screen — name, auto-confirm limit, reset
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../lib/store';
import { savePrefs, clearCredentials, clearHistory, clearActiveTrip, clearPrefs, clearTrips } from '../../lib/storage';
import { hasProfile, deleteProfile, loadProfileRaw, shouldApplyFamilyRailcard, clearConsents, type FamilyMember } from '../../lib/profile';

export default function SettingsScreen() {
  const { userName, autoConfirmLimitUsdc, homeStation, workStation, setPrefs, reset } = useStore();
  const [name, setName]           = useState(userName);
  const [budget, setBudget]       = useState(String(autoConfirmLimitUsdc));
  const [home, setHome]           = useState(homeStation ?? '');
  const [work, setWork]           = useState(workStation ?? '');
  const [saved, setSaved]         = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [familyRailcardReady, setFamilyRailcardReady] = useState(false);

  const refreshProfileState = useCallback(() => {
    void hasProfile().then(setProfileSaved).catch(() => setProfileSaved(false));
    void loadProfileRaw()
      .then((profile) => {
        const members = profile?.familyMembers ?? [];
        setFamilyMembers(members);
        setFamilyRailcardReady(profile ? shouldApplyFamilyRailcard(profile) : false);
      })
      .catch(() => {
        setFamilyMembers([]);
        setFamilyRailcardReady(false);
      });
  }, []);

  useEffect(() => {
    refreshProfileState();
  }, [refreshProfileState]);

  useFocusEffect(useCallback(() => {
    refreshProfileState();
  }, [refreshProfileState]));

  const handleHomeChange = async (value: string) => {
    setHome(value);
    setPrefs({ homeStation: value || null });
    await savePrefs({ homeStation: value.trim() || undefined });
  };

  const handleWorkChange = async (value: string) => {
    setWork(value);
    setPrefs({ workStation: value || null });
    await savePrefs({ workStation: value.trim() || undefined });
  };

  const handleSave = async () => {
    const budgetN   = parseFloat(budget) || 5;
    const newName   = name.trim() || 'there';
    const newHome   = home.trim() || undefined;
    const newWork   = work.trim() || undefined;
    setPrefs({ userName: newName, autoConfirmLimitUsdc: budgetN, homeStation: newHome ?? null, workStation: newWork ?? null });
    await savePrefs({ userName: newName, autoConfirmLimitUsdc: budgetN, homeStation: newHome, workStation: newWork });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    Alert.alert(
      'Reset Bro',
      'This will clear your Bro setup, travel profile, saved trips, stations, consent choices, and local credentials. You will need to set up again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await Promise.all([
              clearCredentials(),
              clearHistory(),
              clearActiveTrip(),
              clearTrips(),
              clearPrefs(),
              clearConsents(),
              deleteProfile(),
            ]);
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
      'Clear all conversation history? Your Bro setup will be preserved.',
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
          <Text style={styles.fieldLabel}>Home station</Text>
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            value={home}
            onChangeText={(value) => { void handleHomeChange(value); }}
            placeholder="e.g. Derby"
            placeholderTextColor="#374151"
            autoCapitalize="words"
          />
          <Text style={styles.fieldLabel}>Work station</Text>
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            value={work}
            onChangeText={(value) => { void handleWorkChange(value); }}
            placeholder="e.g. London St Pancras"
            placeholderTextColor="#374151"
            autoCapitalize="words"
          />
        </Section>

        {/* Auto-confirm spending limit */}
        <Section
          label="BOOKING LIMIT"
          hint="Bro will secure bookings automatically below this amount. Above it, you'll confirm with fingerprint."
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

        {/* Family */}
        <Section
          label="FAMILY & GROUP"
          hint="Add family members so Bro can book group tickets by voice. Names and ages only — no documents needed here."
        >
          <View style={styles.familySummary}>
            <View style={styles.familySummaryRow}>
              <Ionicons name="people" size={16} color="#38bdf8" />
              <Text style={styles.familySummaryTitle}>
                {familyMembers.length > 0
                  ? `${familyMembers.length} family member${familyMembers.length === 1 ? '' : 's'} ready`
                  : 'No family members saved yet'}
              </Text>
            </View>
            <Text style={styles.familySummaryBody}>
              {familyMembers.length > 0
                ? `Bro can book for ${familyMembers.map((member) => member.name).filter(Boolean).join(', ')} without re-entering their details.`
                : 'Add your regular companions here so Bro can understand “me, Maya, and Dad” in one shot.'}
            </Text>
            {familyRailcardReady && (
              <View style={styles.familyRailcardBadge}>
                <Ionicons name="ticket-outline" size={14} color="#4ade80" />
                <Text style={styles.familyRailcardText}>Family & Friends Railcard will auto-apply on eligible UK rail searches.</Text>
              </View>
            )}
          </View>
          <Pressable
            onPress={() => router.push('/(main)/family')}
            style={styles.profileBtn}
          >
            <Ionicons name="people-outline" size={15} color="#818cf8" />
            <Text style={styles.profileBtnText}>{familyMembers.length > 0 ? 'Edit family members' : 'Add family members'}</Text>
          </Pressable>
        </Section>

        {/* Data */}
        <Section label="DATA">
          <Pressable onPress={handleClearHistory} style={styles.dangerRow}>
            <Ionicons name="trash-outline" size={16} color="#6b7280" />
            <Text style={styles.dangerText}>Clear conversation history</Text>
          </Pressable>
          <Pressable onPress={handleReset} style={[styles.dangerRow, { marginTop: 8 }]}>
            <Ionicons name="refresh-outline" size={16} color="#ef4444" />
            <Text style={[styles.dangerText, { color: '#ef4444' }]}>Reset Bro</Text>
          </Pressable>
        </Section>

        <Section
          label="LEGAL"
          hint="Review what Bro stores locally and what it sends only when you confirm a journey."
        >
          <Pressable onPress={() => router.push('/legal/terms')} style={styles.linkRow}>
            <View style={styles.linkCopy}>
              <Text style={styles.linkTitle}>Terms of Service</Text>
              <Text style={styles.linkSubtitle}>How bookings, confirmations, and early-release limits work</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#6b7280" />
          </Pressable>
          <Pressable onPress={() => router.push('/legal/privacy')} style={[styles.linkRow, { marginTop: 10 }]}>
            <View style={styles.linkCopy}>
              <Text style={styles.linkTitle}>Privacy Policy</Text>
              <Text style={styles.linkSubtitle}>What stays on your device and what Bro shares only when needed</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#6b7280" />
          </Pressable>
        </Section>

        {/* Footer */}
        <Text style={styles.footer}>
          Bro 1.0{'\n'}
          Powered by AgentPay · agentpay.gg
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
  fieldLabel: {
    fontSize: 11,
    color: '#4b5563',
    marginTop: 12,
    marginBottom: -2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

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
  familySummary: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  familySummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  familySummaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  familySummaryBody: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
  },
  familyRailcardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#052e16',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 12,
  },
  familyRailcardText: {
    flex: 1,
    fontSize: 12,
    color: '#4ade80',
    lineHeight: 17,
  },

  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#111',
  },
  dangerText: { fontSize: 14, color: '#6b7280' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#111',
  },
  linkCopy: {
    flex: 1,
    paddingRight: 10,
  },
  linkTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f9fafb',
    marginBottom: 4,
  },
  linkSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6b7280',
  },

  footer: {
    fontSize: 11,
    color: '#1f2937',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});
