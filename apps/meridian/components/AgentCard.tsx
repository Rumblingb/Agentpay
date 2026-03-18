/**
 * AgentCard — shows agent trust profile + price
 * Used in both the intent confirmation flow and the discover screen.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Agent } from '../lib/api';

interface Props {
  agent: Agent;
  selected?: boolean;
  onPress?: () => void;
}

function gradeColor(grade: string): string {
  if (grade === 'A' || grade === 'A+') return '#22c55e';
  if (grade === 'B') return '#84cc16';
  if (grade === 'C') return '#f59e0b';
  if (grade === 'New') return '#6366f1';
  return '#6b7280';
}

export function AgentCard({ agent, selected, onPress }: Props) {
  const color = gradeColor(agent.grade);

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, selected && styles.cardSelected]}
    >
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.nameBlock}>
          <Text style={styles.name} numberOfLines={1}>{agent.name}</Text>
          <Text style={styles.category}>{agent.category}</Text>
        </View>
        <View style={[styles.gradeBadge, { borderColor: color }]}>
          <Text style={[styles.gradeText, { color }]}>{agent.grade}</Text>
        </View>
      </View>

      {/* Description */}
      {!!agent.description && (
        <Text style={styles.description} numberOfLines={2}>{agent.description}</Text>
      )}

      {/* Capabilities */}
      {agent.capabilities.length > 0 && (
        <View style={styles.caps}>
          {agent.capabilities.slice(0, 4).map((cap) => (
            <View key={cap} style={styles.capChip}>
              <Text style={styles.capText}>{cap}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Footer: trust score + price */}
      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Ionicons name="shield-checkmark" size={13} color={color} />
          <Text style={[styles.footerScore, { color }]}>
            {agent.trustScore} trust
          </Text>
          {agent.verified && (
            <Ionicons name="checkmark-circle" size={13} color="#22c55e" style={{ marginLeft: 6 }} />
          )}
        </View>
        <Text style={styles.price}>
          {agent.pricePerTaskUsd != null
            ? `$${agent.pricePerTaskUsd} / task`
            : 'Price negotiable'}
        </Text>
      </View>

      {selected && (
        <View style={styles.selectedIndicator}>
          <Ionicons name="checkmark" size={14} color="#fff" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    marginBottom: 10,
  },
  cardSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#13123a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  nameBlock: { flex: 1, marginRight: 10 },
  name: { fontSize: 15, fontWeight: '600', color: '#f9fafb' },
  category: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  gradeBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  gradeText: { fontSize: 12, fontWeight: '700' },
  description: { fontSize: 13, color: '#9ca3af', lineHeight: 18, marginBottom: 8 },
  caps: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10 },
  capChip: {
    backgroundColor: '#1f2937',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  capText: { fontSize: 11, color: '#93c5fd' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerScore: { fontSize: 12, fontWeight: '500' },
  price: { fontSize: 13, color: '#d1d5db', fontWeight: '500' },
  selectedIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
