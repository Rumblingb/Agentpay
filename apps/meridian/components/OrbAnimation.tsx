/**
 * OrbAnimation — the Meridian ambient orb
 *
 * Single visual focal point of the app.
 * Animates differently per phase:
 *   idle      → slow, gentle glow pulse
 *   listening → rapid outer rings expanding outward
 *   thinking  → rotating arc / spinner overlay
 *   executing → slow steady pulse, indigo → violet gradient
 *   done      → green flash then settles
 *   error     → red tint
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Pressable, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { AppPhase } from '../lib/store';

interface Props {
  phase: AppPhase;
  onPressIn: () => void;
  onPressOut: () => void;
  disabled?: boolean;
}

const PHASE_COLORS: Record<AppPhase, [string, string]> = {
  idle:       ['#1e1b4b', '#312e81'],
  listening:  ['#4338ca', '#7c3aed'],
  thinking:   ['#1e3a5f', '#1e40af'],
  confirming: ['#92400e', '#b45309'],
  hiring:     ['#1e3a5f', '#1e40af'],
  executing:  ['#1e1b4b', '#312e81'],
  done:       ['#052e16', '#14532d'],
  error:      ['#450a0a', '#7f1d1d'],
};

const PHASE_ICON: Partial<Record<AppPhase, string>> = {
  idle:       'mic-outline',
  listening:  'mic',
  thinking:   'sparkles',
  confirming: 'help-circle-outline',
  hiring:     'flash',
  executing:  'pulse',
  done:       'checkmark',
  error:      'warning-outline',
};

const PHASE_ICON_COLOR: Record<AppPhase, string> = {
  idle:       '#818cf8',
  listening:  '#fff',
  thinking:   '#93c5fd',
  confirming: '#fcd34d',
  hiring:     '#93c5fd',
  executing:  '#a5b4fc',
  done:       '#4ade80',
  error:      '#f87171',
};

export function OrbAnimation({ phase, onPressIn, onPressOut, disabled }: Props) {
  const glowScale    = useRef(new Animated.Value(1)).current;
  const glowOpacity  = useRef(new Animated.Value(0.3)).current;
  const ring1Scale   = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale   = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const orbScale     = useRef(new Animated.Value(1)).current;
  const spinValue    = useRef(new Animated.Value(0)).current;

  const colors = PHASE_COLORS[phase];
  const icon   = PHASE_ICON[phase] ?? 'mic-outline';
  const iconColor = PHASE_ICON_COLOR[phase];

  useEffect(() => {
    // Stop all running animations
    glowScale.stopAnimation();
    glowOpacity.stopAnimation();
    ring1Scale.stopAnimation();
    ring1Opacity.stopAnimation();
    ring2Scale.stopAnimation();
    ring2Opacity.stopAnimation();
    spinValue.stopAnimation();

    if (phase === 'idle') {
      // Gentle slow pulse
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(glowScale,   { toValue: 1.15, duration: 2000, useNativeDriver: true }),
            Animated.timing(glowOpacity, { toValue: 0.5,  duration: 2000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(glowScale,   { toValue: 1,    duration: 2000, useNativeDriver: true }),
            Animated.timing(glowOpacity, { toValue: 0.2,  duration: 2000, useNativeDriver: true }),
          ]),
        ]),
      ).start();
    }

    if (phase === 'listening') {
      // Rapid expanding rings
      const ringLoop = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scale,   { toValue: 2.2, duration: 1000, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0,   duration: 1000, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(scale,   { toValue: 1,   duration: 0,    useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.6, duration: 0,    useNativeDriver: true }),
            ]),
          ]),
        );
      ringLoop(ring1Scale, ring1Opacity, 0).start();
      ringLoop(ring2Scale, ring2Opacity, 500).start();
      Animated.spring(orbScale, { toValue: 1.08, useNativeDriver: true, speed: 20 }).start();
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      // Slow steady glow + spin arc
      Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowScale,   { toValue: 1.1, duration: 1200, useNativeDriver: true }),
          Animated.timing(glowScale,   { toValue: 1.0, duration: 1200, useNativeDriver: true }),
        ]),
      ).start();
    }

    if (phase === 'done') {
      Animated.sequence([
        Animated.spring(orbScale, { toValue: 1.2, useNativeDriver: true, speed: 30 }),
        Animated.spring(orbScale, { toValue: 1.0, useNativeDriver: true, speed: 10 }),
      ]).start();
    }

    if (phase !== 'listening') {
      Animated.spring(orbScale, { toValue: 1, useNativeDriver: true, speed: 15 }).start();
      ring1Scale.setValue(1);
      ring1Opacity.setValue(0);
      ring2Scale.setValue(1);
      ring2Opacity.setValue(0);
    }
  }, [phase]);

  const spin = spinValue.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const isInteractive = phase === 'idle' || phase === 'listening' || phase === 'confirming' || phase === 'error';

  const handlePressIn = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPressIn();
  };

  const handlePressOut = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPressOut();
  };

  return (
    <View style={styles.container}>
      {/* Outer glow */}
      <Animated.View style={[
        styles.glow,
        { transform: [{ scale: glowScale }], opacity: glowOpacity }
      ]}>
        <LinearGradient colors={[colors[1], 'transparent']} style={styles.glowGrad} />
      </Animated.View>

      {/* Expanding rings (listening) */}
      <Animated.View style={[
        styles.ring,
        { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }
      ]} />
      <Animated.View style={[
        styles.ring,
        { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }
      ]} />

      {/* Spin arc (thinking/executing) */}
      {(phase === 'thinking' || phase === 'hiring' || phase === 'executing') && (
        <Animated.View style={[styles.spinArc, { transform: [{ rotate: spin }] }]}>
          <View style={styles.spinDot} />
        </Animated.View>
      )}

      {/* Main orb */}
      <Animated.View style={{ transform: [{ scale: orbScale }] }}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={disabled || !isInteractive}
        >
          <LinearGradient
            colors={colors}
            style={styles.orb}
          >
            <Ionicons name={icon as any} size={40} color={iconColor} />
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const ORB_SIZE = 120;
const GLOW_SIZE = 220;
const RING_SIZE = 140;

const styles = StyleSheet.create({
  container: {
    width:  GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width:  GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    overflow: 'hidden',
  },
  glowGrad: {
    flex: 1,
    borderRadius: GLOW_SIZE / 2,
  },
  ring: {
    position: 'absolute',
    width:  RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: '#6366f1',
  },
  spinArc: {
    position: 'absolute',
    width:  ORB_SIZE + 24,
    height: ORB_SIZE + 24,
    borderRadius: (ORB_SIZE + 24) / 2,
    alignItems: 'center',
  },
  spinDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#818cf8',
    marginTop: 2,
  },
  orb: {
    width:  ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 15,
  },
});
