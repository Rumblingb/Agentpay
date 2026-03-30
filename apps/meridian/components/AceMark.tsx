/**
 * AceMark — Ace's navigation arrow mark.
 *
 * A frosted glass oval containing the navigation cursor symbol.
 * Used on the boot screen and inside the voice orb.
 *
 * Inspired by the compass/location pointer aesthetic — premium, directional,
 * immediately legible as "movement".
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

interface AceMarkProps {
  size?: number;
  /** Border/ring color of the oval frame */
  ringColor?: string;
  /** Glow halo color */
  glowColor?: string;
  /** Background fill of the oval */
  backgroundColor?: string;
  /** Icon color — defaults to near-white */
  iconColor?: string;
}

export function AceMark({
  size = 96,
  ringColor = 'rgba(210, 237, 255, 0.55)',
  glowColor = '#a9dcff',
  backgroundColor = '#0d1624',
  iconColor = 'rgba(235, 248, 255, 0.95)',
}: AceMarkProps) {
  // Oval is portrait: wider than tall, slight vertical squeeze like the reference
  const ovalW = size * 0.88;
  const ovalH = size * 1.08;
  const iconSize = size * 0.42;
  const glowRadius = size * 0.22;
  const borderW = Math.max(1, size * 0.014);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer halo */}
      <View
        style={{
          position: 'absolute',
          width: ovalW * 1.18,
          height: ovalH * 1.08,
          borderRadius: size,
          backgroundColor: glowColor,
          opacity: 0.08,
          shadowColor: glowColor,
          shadowOpacity: 0.55,
          shadowRadius: glowRadius * 1.6,
          shadowOffset: { width: 0, height: 0 },
        }}
      />

      {/* Glass oval body */}
      <LinearGradient
        colors={[
          'rgba(255,255,255,0.07)',
          'rgba(255,255,255,0.03)',
          'rgba(255,255,255,0.01)',
        ]}
        start={{ x: 0.25, y: 0 }}
        end={{ x: 0.75, y: 1 }}
        style={{
          position: 'absolute',
          width: ovalW,
          height: ovalH,
          borderRadius: size,
          borderWidth: borderW,
          borderColor: ringColor,
          backgroundColor: backgroundColor,
          shadowColor: glowColor,
          shadowOpacity: 0.18,
          shadowRadius: glowRadius,
          shadowOffset: { width: 0, height: 4 },
          overflow: 'hidden',
        }}
      >
        {/* Subtle inner top sheen */}
        <LinearGradient
          colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </LinearGradient>

      {/* Navigation arrow icon */}
      <View
        style={{
          shadowColor: iconColor,
          shadowOpacity: 0.5,
          shadowRadius: glowRadius * 0.7,
          shadowOffset: { width: 0, height: 0 },
          // Slight upward offset so arrow sits in the optical centre of the oval
          marginBottom: size * 0.04,
        }}
      >
        <Ionicons
          name="navigate"
          size={iconSize}
          color={iconColor}
        />
      </View>
    </View>
  );
}
