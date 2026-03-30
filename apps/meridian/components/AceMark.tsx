import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface AceMarkProps {
  size?: number;
  ringColor?: string;
  glowColor?: string;
  backgroundColor?: string;
}

export function AceMark({
  size = 96,
  ringColor = 'rgba(210, 237, 255, 0.88)',
  glowColor = '#9dd9ff',
  backgroundColor = '#0d1624',
}: AceMarkProps) {
  const styles = makeStyles(size, ringColor, glowColor, backgroundColor);

  return (
    <View style={styles.frame}>
      <View style={styles.glow} />
      <View style={styles.ring} />

      <View style={styles.markWrap}>
        <LinearGradient
          colors={['rgba(255,255,255,0.98)', 'rgba(205,229,255,0.84)']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[styles.stroke, styles.leftStroke]}
        />
        <LinearGradient
          colors={['rgba(255,255,255,0.98)', 'rgba(205,229,255,0.84)']}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[styles.stroke, styles.rightStroke]}
        />

        <LinearGradient
          colors={[backgroundColor, '#1b2738']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.innerDrop}
        />
      </View>
    </View>
  );
}

function makeStyles(size: number, ringColor: string, glowColor: string, backgroundColor: string) {
  const ringW = size * 1.04;
  const ringH = size * 0.82;
  const strokeW = size * 0.16;
  const leftH = size * 0.54;
  const rightH = size * 0.66;
  const shadowRadius = size * 0.16;

  return StyleSheet.create({
    frame: {
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
    },
    glow: {
      position: 'absolute',
      width: ringW * 1.02,
      height: ringH * 1.02,
      borderRadius: size,
      backgroundColor: glowColor,
      opacity: 0.12,
      shadowColor: glowColor,
      shadowOpacity: 0.42,
      shadowRadius,
      shadowOffset: { width: 0, height: 0 },
    },
    ring: {
      position: 'absolute',
      width: ringW,
      height: ringH,
      borderRadius: size,
      borderWidth: Math.max(1, size * 0.016),
      borderColor: ringColor,
      backgroundColor: 'rgba(255,255,255,0.02)',
    },
    markWrap: {
      width: size * 0.58,
      height: size * 0.64,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stroke: {
      position: 'absolute',
      width: strokeW,
      borderRadius: size,
      shadowColor: '#d9ecff',
      shadowOpacity: 0.26,
      shadowRadius: size * 0.08,
      shadowOffset: { width: 0, height: 0 },
    },
    leftStroke: {
      height: leftH,
      left: size * 0.06,
      top: size * 0.11,
      transform: [{ rotate: '28deg' }],
    },
    rightStroke: {
      height: rightH,
      right: size * 0.06,
      top: size * 0.04,
      transform: [{ rotate: '-26deg' }],
    },
    innerDrop: {
      position: 'absolute',
      width: size * 0.15,
      height: size * 0.24,
      borderRadius: size,
      top: size * 0.24,
      left: size * 0.215,
      transform: [{ rotate: '16deg' }],
      borderWidth: Math.max(1, size * 0.01),
      borderColor: 'rgba(255,255,255,0.08)',
    },
  });
}

