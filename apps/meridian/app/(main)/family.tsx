/**
 * Family Members screen
 *
 * Add, edit, and remove travel companions so Bro can book group tickets by voice.
 * "Book me, Maya, and Dad on the 10:15" just works.
 *
 * Data stored in SecureStore as part of TravelProfile.
 * No documents collected here — just names, relationships, ages, and railcards.
 * Document details (passport) are added when a flight booking requires them.
 */

import React, { useEffect, useState, useCallback } from 'react';
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
import { C } from '../../lib/theme';
import { loadProfileRaw, saveProfile, type FamilyMember, type RailcardType, makeFamilyMemberId } from '../../lib/profile';

const RAILCARD_OPTIONS: { label: string; value: RailcardType }[] = [
  { label: 'None',              value: 'none' },
  { label: '16–25',             value: '16-25' },
  { label: 'Senior',            value: 'senior' },
  { label: 'Two Together',      value: 'two-together' },
  { label: 'Disabled Persons',  value: 'disabled' },
  { label: 'HM Forces',         value: 'hm-forces' },
];

type Relationship = 'adult' | 'child' | 'infant';
const REL_LABELS: Record<Relationship, string> = {
  adult: 'Adult',
  child: 'Child (5–15)',
  infant: 'Infant (under 5)',
};

// ── Blank member template ─────────────────────────────────────────────────────

function blankMember(): FamilyMember {
  return {
    id:           makeFamilyMemberId(),
    name:         '',
    relationship: 'adult',
  };
}

// ── Member edit card ──────────────────────────────────────────────────────────

function MemberCard({
  member,
  onChange,
  onRemove,
}: {
  member: FamilyMember;
  onChange: (updated: FamilyMember) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          {member.relationship === 'infant' ? '👶' : member.relationship === 'child' ? '🧒' : '🧑'}{' '}
          {member.name || 'New member'}
        </Text>
        <Pressable onPress={onRemove} hitSlop={12}>
          <Ionicons name="trash-outline" size={18} color="#f87171" />
        </Pressable>
      </View>

      {/* Name */}
      <Text style={styles.fieldLabel}>First name (used by voice)</Text>
      <TextInput
        style={styles.input}
        value={member.name}
        onChangeText={v => onChange({ ...member, name: v })}
        placeholder="e.g. Maya"
        placeholderTextColor="#4b5563"
        autoCapitalize="words"
      />

      {/* Relationship */}
      <Text style={styles.fieldLabel}>Relationship</Text>
      <View style={styles.pillRow}>
        {(Object.keys(REL_LABELS) as Relationship[]).map(rel => (
          <Pressable
            key={rel}
            onPress={() => onChange({ ...member, relationship: rel })}
            style={[styles.pill, member.relationship === rel && styles.pillActive]}
          >
            <Text style={[styles.pillText, member.relationship === rel && styles.pillTextActive]}>
              {REL_LABELS[rel]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Date of birth — needed for child pricing + flights */}
      <Text style={styles.fieldLabel}>Date of birth (optional — needed for flights)</Text>
      <TextInput
        style={styles.input}
        value={member.dateOfBirth ?? ''}
        onChangeText={v => onChange({ ...member, dateOfBirth: v || undefined })}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#4b5563"
        keyboardType="numeric"
      />

      {/* Railcard (adults only) */}
      {member.relationship === 'adult' && (
        <>
          <Text style={styles.fieldLabel}>UK Railcard</Text>
          <View style={styles.pillRow}>
            {RAILCARD_OPTIONS.map(opt => (
              <Pressable
                key={opt.value}
                onPress={() => onChange({ ...member, railcard: opt.value })}
                style={[styles.pill, (member.railcard ?? 'none') === opt.value && styles.pillActive]}
              >
                <Text style={[styles.pillText, (member.railcard ?? 'none') === opt.value && styles.pillTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function FamilyScreen() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfileRaw().then(p => {
      setMembers(p?.familyMembers ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const profile = await loadProfileRaw();
      if (!profile) {
        Alert.alert('No profile', 'Set up your travel profile first in Settings → Travel Profile.');
        return;
      }
      await saveProfile({ ...profile, familyMembers: members });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      Alert.alert('Cancelled', 'Authentication is required to save family members.');
    } finally {
      setSaving(false);
    }
  }, [members]);

  const addMember = () => setMembers(ms => [...ms, blankMember()]);

  const updateMember = (id: string, updated: FamilyMember) =>
    setMembers(ms => ms.map(m => m.id === id ? updated : m));

  const removeMember = (id: string) =>
    setMembers(ms => ms.filter(m => m.id !== id));

  // Auto-detect Family Railcard eligibility
  const adultCount  = 1 + members.filter(m => m.relationship === 'adult').length;
  const childCount  = members.filter(m => m.relationship === 'child').length;
  const familyRailcardEligible = adultCount >= 2 && childCount >= 1 && childCount <= 4;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={C.textMuted} />
          </Pressable>
          <Text style={styles.title}>Family & Group</Text>
          <Pressable onPress={handleSave} disabled={saving} hitSlop={12}>
            <Text style={[styles.saveBtn, saved && styles.saveBtnDone]}>
              {saving ? '…' : saved ? 'Saved ✓' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>
          Add travel companions so Bro can book group tickets by voice.
          {'\n'}Try: "Book me, Maya, and Dad on the 10:15 to Edinburgh"
        </Text>

        {/* Family Railcard badge */}
        {familyRailcardEligible && (
          <View style={styles.familyBadge}>
            <Ionicons name="ticket-outline" size={14} color="#4ade80" style={{ marginRight: 6 }} />
            <Text style={styles.familyBadgeText}>
              Family & Friends Railcard applies — Bro will apply 1/3 off adult fares + 60% off children automatically
            </Text>
          </View>
        )}

        {/* Members */}
        {loading ? (
          <Text style={styles.loadingText}>Loading…</Text>
        ) : members.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={40} color="#374151" />
            <Text style={styles.emptyText}>No family members yet</Text>
            <Text style={styles.emptyHint}>
              Add your travel companions below. Bro will remember them across all bookings.
            </Text>
          </View>
        ) : (
          members.map(m => (
            <MemberCard
              key={m.id}
              member={m}
              onChange={updated => updateMember(m.id, updated)}
              onRemove={() => removeMember(m.id)}
            />
          ))
        )}

        {/* Add button */}
        <Pressable onPress={addMember} style={styles.addBtn}>
          <Ionicons name="add-circle-outline" size={18} color={C.sky} style={{ marginRight: 8 }} />
          <Text style={styles.addBtnText}>Add family member</Text>
        </Pressable>

        {/* Hint about documents */}
        {members.length > 0 && (
          <Text style={styles.docHint}>
            Passport details for flights can be added in your travel profile. Bro will ask if they're needed for a booking.
          </Text>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: C.bg },
  container:        { paddingHorizontal: 20, paddingBottom: 40 },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, marginBottom: 16 },
  title:            { fontSize: 17, fontWeight: '600', color: C.textPrimary },
  saveBtn:          { fontSize: 15, color: C.sky, fontWeight: '500' },
  saveBtnDone:      { color: '#4ade80' },
  subtitle:         { fontSize: 13, color: C.textMuted, lineHeight: 20, marginBottom: 20 },
  familyBadge:      { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#052e16', borderRadius: 8, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: '#166534' },
  familyBadgeText:  { flex: 1, fontSize: 12, color: '#4ade80', lineHeight: 18 },
  loadingText:      { color: C.textMuted, textAlign: 'center', marginTop: 40 },
  emptyState:       { alignItems: 'center', paddingVertical: 40 },
  emptyText:        { fontSize: 16, color: C.textPrimary, fontWeight: '500', marginTop: 12, marginBottom: 6 },
  emptyHint:        { fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  card:             { backgroundColor: '#111827', borderRadius: 12, borderWidth: 1, borderColor: '#1e293b', padding: 16, marginBottom: 16 },
  cardHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitle:        { fontSize: 15, fontWeight: '600', color: C.textPrimary },
  fieldLabel:       { fontSize: 11, color: C.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 },
  input:            { backgroundColor: '#0f172a', borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', color: C.textPrimary, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  pillRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill:             { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#1e293b' },
  pillActive:       { backgroundColor: '#0c4a6e', borderColor: C.sky },
  pillText:         { fontSize: 12, color: C.textMuted },
  pillTextActive:   { color: C.sky, fontWeight: '600' },
  addBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#1e293b', marginTop: 4, marginBottom: 16 },
  addBtnText:       { fontSize: 15, color: C.sky, fontWeight: '500' },
  docHint:          { fontSize: 12, color: '#374151', textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },
});
