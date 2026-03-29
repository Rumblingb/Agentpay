/**
 * OrbAnimation - Ace's held speak object
 *
 * The control should feel closer to a small concierge mascot than a generic mic.
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
  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.28)).current;
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const orbScale = useRef(new Animated.Value(1)).current;
  const mascotTilt = useRef(new Animated.Value(0)).current;

  const colors = PHASE_COLORS[phase];
  const accent = ACCENT_COLOR[phase];
  const shadowColor = PHASE_SHADOW[phase] ?? '#10b981';

  useEffect(() => {
    glowScale.stopAnimation();
    glowOpacity.stopAnimation();
    ring1Scale.stopAnimation();
    ring1Opacity.stopAnimation();
    ring2Scale.stopAnimation();
    ring2Opacity.stopAnimation();
    orbScale.stopAnimation();
    mascotTilt.stopAnimation();

    if (phase !== 'done' && phase !== 'error') {
      mascotTilt.setValue(0);
    }

    if (phase === 'idle') {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(glowScale, { toValue: 1.12, duration: 2200, useNativeDriver: true }),
            Animated.timing(glowOpacity, { toValue: 0.46, duration: 2200, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(glowScale, { toValue: 1, duration: 2200, useNativeDriver: true }),
            Animated.timing(glowOpacity, { toValue: 0.2, duration: 2200, useNativeDriver: true }),
          ]),
        ]),
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(mascotTilt, { toValue: -6, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mascotTilt, { toValue: 6, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
    }

    if (phase === 'listening') {
      const pulse = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scale, { toValue: 1.9, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0, duration: 2200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.34, duration: 0, useNativeDriver: true }),
            ]),
          ]),
        );

      pulse(ring1Scale, ring1Opacity, 0).start();
      pulse(ring2Scale, ring2Opacity, 1100).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(orbScale, { toValue: 1.05, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(orbScale, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();

      Animated.timing(glowOpacity, { toValue: 0.62, duration: 500, useNativeDriver: true }).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(mascotTilt, { toValue: -4, duration: 110, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(mascotTilt, { toValue: 4, duration: 110, easing: Easing.linear, useNativeDriver: true }),
        ]),
      ).start();
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowScale, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
          Animated.timing(glowScale, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ]),
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(mascotTilt, { toValue: -8, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mascotTilt, { toValue: 8, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
    }

    if (phase === 'confirming') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(mascotTilt, { toValue: -3, duration: 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mascotTilt, { toValue: 3, duration: 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
    }

    if (phase === 'done') {
      Animated.sequence([
        Animated.spring(orbScale, { toValue: 1.18, useNativeDriver: true, speed: 30 }),
        Animated.spring(orbScale, { toValue: 1, useNativeDriver: true, speed: 10 }),
      ]).start();
      Animated.spring(mascotTilt, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
    }

    if (phase === 'error') {
      Animated.spring(mascotTilt, { toValue: -10, useNativeDriver: true, speed: 8, bounciness: 4 }).start();
    }

    if (phase !== 'listening' && phase !== 'done') {
      Animated.spring(orbScale, { toValue: 1, useNativeDriver: true, speed: 15 }).start();
      Animated.timing(glowOpacity, { toValue: phase === 'idle' ? 0.28 : 0.2, duration: 400, useNativeDriver: true }).start();
      ring1Scale.setValue(1);
      ring1Opacity.setValue(0);
      ring2Scale.setValue(1);
      ring2Opacity.setValue(0);
    }
  }, [phase, glowOpacity, glowScale, mascotTilt, orbScale, ring1Opacity, ring1Scale, ring2Opacity, ring2Scale]);

  const tiltDeg = mascotTilt.interpolate({
    inputRange: [-12, 12],
    outputRange: ['-12deg', '12deg'],
  });

  const isInteractive = phase === 'idle' || phase === 'listening' || phase === 'confirming' || phase === 'error';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  const handlePressIn = () => {
    if (disabled || !isInteractive || onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPressIn?.();
  };

  const handlePressOut = () => {
    if (disabled || !isInteractive || onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPressOut?.();
  };

  const showStatusIcon = phase === 'done' || phase === 'error';

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}>
        <LinearGradient colors={[colors[1], 'transparent']} style={styles.glowGrad} />
      </Animated.View>

      <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
      <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />

      <Animated.View style={{ transform: [{ scale: orbScale }] }}>
        <Pressable
          onPress={onPress ? handlePress : undefined}
          onPressIn={!onPress ? handlePressIn : undefined}
          onPressOut={!onPress ? handlePressOut : undefined}
          disabled={disabled || !isInteractive}
        >
          <LinearGradient colors={colors} style={[styles.orb, { shadowColor }]}>
            {showStatusIcon ? (
              <Ionicons
                name={phase === 'done' ? 'checkmark' : 'warning-outline'}
                size={40}
                color={phase === 'done' ? '#4ade80' : '#f87171'}
              />
            ) : (
              <AceMascot rotation={tiltDeg} color={accent} />
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function AceMascot({
  rotation,
  color,
}: {
  rotation: Animated.AnimatedInterpolation<string>;
  color: string;
}) {
  return (
    <Animated.View style={[mascotStyles.wrap, { transform: [{ rotate: rotation }] }]}>
      <View style={[mascotStyles.hatBrim, { borderColor: `${color}55` }]} />
      <View style={[mascotStyles.hatTop, { borderColor: `${color}55`, backgroundColor: `${color}14` }]} />
      <View style={mascotStyles.head}>
        <View style={mascotStyles.eyeRow}>
          <View style={[mascotStyles.eye, { backgroundColor: color }]} />
          <View style={[mascotStyles.eye, { backgroundColor: color }]} />
        </View>
        <View style={mascotStyles.mustacheRow}>
          <View style={[mascotStyles.mustacheWing, mascotStyles.mustacheLeft, { borderColor: `${color}bb` }]} />
          <View style={[mascotStyles.mustacheWing, mascotStyles.mustacheRight, { borderColor: `${color}bb` }]} />
        </View>
        <View style={[mascotStyles.cheekGlow, { backgroundColor: `${color}22` }]} />
      </View>
      <View style={mascotStyles.collar}>
        <View style={[mascotStyles.collarWing, mascotStyles.collarLeft, { borderTopColor: `${color}70` }]} />
        <View style={[mascotStyles.collarGem, { backgroundColor: color }]} />
        <View style={[mascotStyles.collarWing, mascotStyles.collarRight, { borderTopColor: `${color}70` }]} />
      </View>
    </Animated.View>
  );
}

const mascotStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hatBrim: {
    width: 52,
    height: 8,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  hatTop: {
    width: 28,
    height: 20,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    marginBottom: -2,
  },
  head: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 18,
    overflow: 'hidden',
  },
  eyeRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 11,
  },
  eye: {
    width: 6,
    height: 10,
    borderRadius: 999,
    opacity: 0.95,
  },
  mustacheRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  mustacheWing: {
    width: 14,
    height: 8,
    borderTopWidth: 2,
  },
  mustacheLeft: {
    borderTopLeftRadius: 999,
    borderBottomRightRadius: 999,
    transform: [{ rotate: '-10deg' }],
  },
  mustacheRight: {
    borderTopRightRadius: 999,
    borderBottomLeftRadius: 999,
    transform: [{ rotate: '10deg' }],
  },
  cheekGlow: {
    position: 'absolute',
    bottom: 10,
    width: 36,
    height: 12,
    borderRadius: 999,
  },
  collar: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  collarWing: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  collarLeft: {
    transform: [{ rotate: '10deg' }],
  },
  collarRight: {
    transform: [{ rotate: '-10deg' }],
  },
  collarGem: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

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
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 32,
    elevation: 15,
  },
});
