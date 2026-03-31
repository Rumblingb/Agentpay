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
import { AceMark } from './AceMark';

interface Props {
  phase: AppPhase;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
}

const PHASE_COLORS: Record<AppPhase, [string, string]> = {
  idle: ['#151b23', '#2f3945'],
  listening: ['#19212a', '#34414d'],
  thinking: ['#0f1722', '#243548'],
  confirming: ['#1f1a15', '#4d4030'],
  hiring: ['#0f1722', '#243548'],
  executing: ['#151b23', '#2f3945'],
  done: ['#162017', '#334337'],
  error: ['#450a0a', '#7f1d1d'],
};

const ACCENT_COLOR: Record<AppPhase, string> = {
  idle: '#dcecff',
  listening: '#e3f2ff',
  thinking: '#a7d5ff',
  confirming: '#e8d6b2',
  hiring: '#a7d5ff',
  executing: '#dcecff',
  done: '#d6e7da',
  error: '#f1b3b3',
};

const GLASS_RING = 'rgba(226, 242, 255, 0.82)';
const GLASS_GLOW = '#c7e7ff';
const SILVER_MARK = 'rgba(244, 248, 252, 0.98)';
const GLASS_BODY = '#313946';
const ORB_SHADOW: Record<AppPhase, string> = {
  idle: '#b9d8f2',
  listening: '#c7e7ff',
  thinking: '#8bc8ff',
  confirming: '#e2c89c',
  hiring: '#8bc8ff',
  executing: '#b9d8f2',
  done: '#b8d6bf',
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
  const markHeading = useRef(new Animated.Value(0)).current;

  const colors      = PHASE_COLORS[phase];
  const accent      = ACCENT_COLOR[phase];
  const shadowColor = ORB_SHADOW[phase] ?? '#b9d8f2';

  useEffect(() => {
    glowScale.stopAnimation();
    glowOpacity.stopAnimation();
    ring1Scale.stopAnimation();
    ring1Opacity.stopAnimation();
    ring2Scale.stopAnimation();
    ring2Opacity.stopAnimation();
    orbScale.stopAnimation();
    orbLift.stopAnimation();
    markHeading.stopAnimation();

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
      Animated.loop(
        Animated.sequence([
          Animated.timing(markHeading, { toValue: -2, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(markHeading, { toValue: 3, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(markHeading, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
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
      Animated.loop(
        Animated.sequence([
          Animated.timing(markHeading, { toValue: -5, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(markHeading, { toValue: 6, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(markHeading, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
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
      Animated.loop(
        Animated.sequence([
          Animated.timing(markHeading, { toValue: -3, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(markHeading, { toValue: 4, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(markHeading, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
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
    if (phase === 'confirming' || phase === 'error') {
      Animated.timing(markHeading, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    }
  }, [glowOpacity, glowScale, markHeading, orbLift, orbScale, phase, ring1Opacity, ring1Scale, ring2Opacity, ring2Scale]);

  const isInteractive = phase === 'idle' || phase === 'listening' || phase === 'confirming' || phase === 'error';

  const handlePress    = () => { if (!disabled && isInteractive) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress?.(); } };
  const handlePressIn  = () => { if (!disabled && isInteractive && !onPress) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPressIn?.(); } };
  const handlePressOut = () => { if (!disabled && isInteractive && !onPress) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);  onPressOut?.(); } };

  const iconName  = phase === 'done' ? 'checkmark' : 'warning-outline';
  const iconColor = phase === 'done' ? '#d8eadc' : '#f2b2b2';
  const iconSize  = 38;
  const heading = markHeading.interpolate({
    inputRange: [-8, 8],
    outputRange: ['4deg', '20deg'],
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}>
        <LinearGradient colors={[shadowColor, 'transparent']} style={styles.glowGrad} />
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
            {phase === 'done' || phase === 'error' ? (
              <Ionicons name={iconName as any} size={iconSize} color={iconColor} />
            ) : (
              <Animated.View style={{ transform: [{ rotate: heading }] }}>
                <AceMark
                  size={64}
                  ringColor={GLASS_RING}
                  glowColor={GLASS_GLOW}
                  backgroundColor={GLASS_BODY}
                  iconColor={SILVER_MARK}
                  headingDeg={0}
                />
              </Animated.View>
            )}
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
    borderWidth: 1.2,
    borderColor: 'rgba(220, 236, 255, 0.9)',
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(235, 244, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 30,
    elevation: 15,
  },
});
