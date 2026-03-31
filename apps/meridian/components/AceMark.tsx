import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

interface AceMarkProps {
  size?: number;
  ringColor?: string;
  glowColor?: string;
  backgroundColor?: string;
  iconColor?: string;
}

export function AceMark({
  size = 96,
  ringColor = 'rgba(220, 238, 255, 0.76)',
  glowColor = '#cbe8ff',
  backgroundColor = '#303844',
  iconColor = 'rgba(246, 250, 255, 0.98)',
}: AceMarkProps) {
  const ovalW = size * 0.86;
  const ovalH = size * 1.04;
  const borderW = Math.max(1, size * 0.015);
  const haloW = ovalW * 1.2;
  const haloH = ovalH * 1.1;
  const iconSize = size * 0.42;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: haloW,
          height: haloH,
          borderRadius: size,
          backgroundColor: glowColor,
          opacity: 0.1,
          shadowColor: glowColor,
          shadowOpacity: 0.5,
          shadowRadius: size * 0.34,
          shadowOffset: { width: 0, height: 0 },
        }}
      />

      <LinearGradient
        colors={[
          'rgba(255,255,255,0.14)',
          'rgba(255,255,255,0.06)',
          'rgba(255,255,255,0.015)',
        ]}
        start={{ x: 0.18, y: 0.04 }}
        end={{ x: 0.86, y: 0.92 }}
        style={{
          position: 'absolute',
          width: ovalW,
          height: ovalH,
          borderRadius: size,
          borderWidth: borderW,
          borderColor: ringColor,
          backgroundColor,
          overflow: 'hidden',
          shadowColor: glowColor,
          shadowOpacity: 0.2,
          shadowRadius: size * 0.2,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <LinearGradient
          colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']}
          start={{ x: 0.18, y: 0 }}
          end={{ x: 0.72, y: 0.46 }}
          style={StyleSheet.absoluteFill}
        />
      </LinearGradient>

      <View
        style={{
          marginBottom: size * 0.015,
          shadowColor: '#ecf7ff',
          shadowOpacity: 0.42,
          shadowRadius: size * 0.14,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <Ionicons
          name="navigate"
          size={iconSize}
          color={iconColor}
          style={{ transform: [{ rotate: '12deg' }] }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({});
