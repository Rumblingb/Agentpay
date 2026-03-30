/**
 * OrbAnimation - Ace's held speak object
 *
 * The control should feel like an Ace sigil or held instrument, not a generic mic.
 * It stays calm at rest, wakes up while listening, and remains legible in every phase.
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Pressable, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { AppPhase } from '../lib/store';
import { PHASE_SHADOW } from '../lib/theme';

interface Props {
  phase: AppPhase;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
}

const PHASE_COLORS: Record<AppPhase, [string, string]> = {
  idle: ['#052e16', '#064e3b'],
  listening: ['#053530', '#065f46'],
  thinking: ['#0c2240', '#1e3a5f'],
  choosing: ['#052e16', '#064e3b'],
  confirming: ['#451a03', '#92400e'],
  hiring: ['#0c2240', '#1e3a5f'],
  executing: ['#052e16', '#064e3b'],
  done: ['#052e16', '#14532d'],
  error: ['#450a0a', '#7f1d1d'],
};

const ACCENT_COLOR: Record<AppPhase, string> = {
  idle: '#34d399',
  listening: '#6ee7b7',
  thinking: '#38bdf8',
  choosing: '#34d399',
  confirming: '#fcd34d',
  hiring: '#38bdf8',
  executing: '#34d399',
  done: '#4ade80',
  error: '#f87171',
};

export function OrbAnimation({ phase, onPress, onPressIn, onPressOut, disabled }: Props) {
  const glowScale  = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.28)).current;
  const ring1Scale  = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale  = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const orbScale    = useRef(new Animated.Value(1)).current;
  const orbLift     = useRef(new Animated.Value(0)).current;

  const colors      = PHASE_COLORS[phase];
  const accent      = ACCENT_COLOR[phase];
  const shadowColor = PHASE_SHADOW[phase] ?? '#10b981';

  useEffect(() => {
    glowScale.stopAnimation();
    glowOpacity.stopAnimation();
    ring1Scale.stopAnimation();
    ring1Opacity.stopAnimation();
    ring2Scale.stopAnimation();
    ring2Opacity.stopAnimation();
    orbScale.stopAnimation();
    orbLift.stopAnimation();

    if (phase === 'idle') {
      // Slow breath — calm, present
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(glowScale,   { toValue: 1.12, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(glowOpacity, { toValue: 0.44, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(glowScale,   { toValue: 1,    duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(glowOpacity, { toValue: 0.20, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        ]),
      ).start();
      // Very subtle float
      Animated.loop(
        Animated.sequence([
          Animated.timing(orbLift, { toValue: -3, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(orbLift, { toValue:  0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
    }

    if (phase === 'listening') {
      // Two expanding rings — sound waves
      const pulse = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scale,   { toValue: 2.0, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0,   duration: 2000, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(scale,   { toValue: 1,    duration: 0, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.32, duration: 0, useNativeDriver: true }),
            ]),
          ]),
        );
      pulse(ring1Scale, ring1Opacity, 0).start();
      pulse(ring2Scale, ring2Opacity, 1000).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(orbScale, { toValue: 1.06, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(orbScale, { toValue: 1,    duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
      Animated.timing(glowOpacity, { toValue: 0.6, duration: 400, useNativeDriver: true }).start();
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowScale,   { toValue: 1.08, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(glowScale,   { toValue: 1,    duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(orbLift, { toValue: -2, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(orbLift, { toValue:  0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
    }

    if (phase === 'done') {
      Animated.sequence([
        Animated.spring(orbScale, { toValue: 1.16, useNativeDriver: true, speed: 28 }),
        Animated.spring(orbScale, { toValue: 1,    useNativeDriver: true, speed: 12 }),
      ]).start();
      Animated.spring(orbLift, { toValue: -4, useNativeDriver: true, speed: 18, bounciness: 8 }).start();
    }

    if (phase !== 'listening' && phase !== 'done') {
      Animated.spring(orbScale,    { toValue: 1,   useNativeDriver: true, speed: 15 }).start();
      Animated.timing(glowOpacity, { toValue: phase === 'idle' ? 0.28 : 0.2, duration: 400, useNativeDriver: true }).start();
      ring1Scale.setValue(1);   ring1Opacity.setValue(0);
      ring2Scale.setValue(1);   ring2Opacity.setValue(0);
    }
  }, [phase, glowOpacity, glowScale, orbLift, orbScale, ring1Opacity, ring1Scale, ring2Opacity, ring2Scale]);

  const isInteractive = phase === 'idle' || phase === 'listening' || phase === 'confirming' || phase === 'error';

  const handlePress    = () => { if (!disabled && isInteractive) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress?.(); } };
  const handlePressIn  = () => { if (!disabled && isInteractive && !onPress) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPressIn?.(); } };
  const handlePressOut = () => { if (!disabled && isInteractive && !onPress) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);  onPressOut?.(); } };

  // Icon — single solid color, no decoration
  const iconName  = phase === 'done'  ? 'checkmark'      :
                    phase === 'error' ? 'warning-outline' : 'mic';
  const iconColor = phase === 'done'  ? '#4ade80'         :
                    phase === 'error' ? '#f87171'          : accent;
  const iconSize  = phase === 'done' || phase === 'error' ? 38 : 36;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}>
        <LinearGradient colors={[colors[1], 'transparent']} style={styles.glowGrad} />
      </Animated.View>

      <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity, borderColor: accent }]} />
      <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity, borderColor: accent }]} />

      <Animated.View style={{ transform: [{ scale: orbScale }, { translateY: orbLift }] }}>
        <Pressable
          onPress={onPress ? handlePress : undefined}
          onPressIn={!onPress ? handlePressIn : undefined}
          onPressOut={!onPress ? handlePressOut : undefined}
          disabled={disabled || !isInteractive}
        >
          <LinearGradient colors={colors} style={[styles.orb, { shadowColor }]}>
            <Ionicons name={iconName as any} size={iconSize} color={iconColor} />
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
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
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
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.5,
    borderColor: '#10b981',
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 32,
    elevation: 15,
  },
});
