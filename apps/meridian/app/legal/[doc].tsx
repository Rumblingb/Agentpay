import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { LEGAL_DOCS, type LegalDocKey } from '../../lib/legal';

function getDocKey(value: string | string[] | undefined): LegalDocKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'privacy' ? 'privacy' : 'terms';
}

export default function LegalDocScreen() {
  const params = useLocalSearchParams<{ doc?: string }>();
  const key = getDocKey(params.doc);
  const doc = LEGAL_DOCS[key];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color="#9ca3af" />
          </Pressable>
          <Text style={styles.headerTitle}>{doc.title}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Text style={styles.updated}>Updated {doc.updatedAt}</Text>
        <Text style={styles.intro}>{doc.intro}</Text>

        {doc.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.heading}</Text>
            {section.body.map((paragraph, idx) => (
              <Text key={`${section.heading}-${idx}`} style={styles.sectionBody}>
                {paragraph}
              </Text>
            ))}
          </View>
        ))}

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>Train-first release</Text>
          <Text style={styles.footerText}>
            Bro is currently focused on train journeys. If something in the app looks unclear, pause and review before confirming a booking.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },
  container: { padding: 24, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f9fafb',
  },
  headerSpacer: {
    width: 22,
  },
  updated: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 12,
  },
  intro: {
    fontSize: 15,
    lineHeight: 23,
    color: '#d1d5db',
    marginBottom: 24,
  },
  section: {
    marginBottom: 22,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f1115',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f3f4f6',
    marginBottom: 10,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#cbd5e1',
    marginBottom: 8,
  },
  footerCard: {
    marginTop: 8,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  footerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e5e7eb',
    marginBottom: 6,
  },
  footerText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#9ca3af',
  },
});
