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
  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.28)).current;
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const orbScale = useRef(new Animated.Value(1)).current;
  const mascotTilt = useRef(new Animated.Value(0)).current;
  const mascotLift = useRef(new Animated.Value(0)).current;

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
    mascotLift.stopAnimation();

    if (phase !== 'done' && phase !== 'error') {
      mascotTilt.setValue(0);
      mascotLift.setValue(0);
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
      Animated.loop(
        Animated.sequence([
          Animated.timing(mascotLift, { toValue: -2, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mascotLift, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
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
          Animated.timing(mascotLift, { toValue: -4, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mascotLift, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
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
          Animated.timing(mascotTilt, { toValue: -4, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mascotTilt, { toValue: 4, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(mascotLift, { toValue: -2, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mascotLift, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
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
      Animated.timing(mascotLift, { toValue: -1, duration: 260, useNativeDriver: true }).start();
    }

    if (phase === 'done') {
      Animated.sequence([
        Animated.spring(orbScale, { toValue: 1.18, useNativeDriver: true, speed: 30 }),
        Animated.spring(orbScale, { toValue: 1, useNativeDriver: true, speed: 10 }),
      ]).start();
      Animated.spring(mascotTilt, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
      Animated.spring(mascotLift, { toValue: -3, useNativeDriver: true, speed: 18, bounciness: 8 }).start();
    }

    if (phase === 'error') {
      Animated.spring(mascotTilt, { toValue: -10, useNativeDriver: true, speed: 8, bounciness: 4 }).start();
      Animated.timing(mascotLift, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    }

    if (phase !== 'listening' && phase !== 'done') {
      Animated.spring(orbScale, { toValue: 1, useNativeDriver: true, speed: 15 }).start();
      Animated.timing(glowOpacity, { toValue: phase === 'idle' ? 0.28 : 0.2, duration: 400, useNativeDriver: true }).start();
      ring1Scale.setValue(1);
      ring1Opacity.setValue(0);
      ring2Scale.setValue(1);
      ring2Opacity.setValue(0);
    }
  }, [phase, glowOpacity, glowScale, mascotLift, mascotTilt, orbScale, ring1Opacity, ring1Scale, ring2Opacity, ring2Scale]);

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

      <Animated.View style={{ transform: [{ scale: orbScale }, { translateY: mascotLift }] }}>
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
              <AceSigil rotation={tiltDeg} color={accent} />
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function AceSigil({
  rotation,
  color,
}: {
  rotation: Animated.AnimatedInterpolation<string>;
  color: string;
}) {
  return (
    <Animated.View style={[sigilStyles.wrap, { transform: [{ rotate: rotation }] }]}>
      <View style={sigilStyles.crownWrap}>
        <View style={[sigilStyles.crownSide, { borderColor: `${color}48` }]} />
        <View style={[sigilStyles.crownGem, { backgroundColor: color, shadowColor: color }]} />
        <View style={[sigilStyles.crownSide, { borderColor: `${color}48` }]} />
      </View>

      <View style={[sigilStyles.body, { borderColor: `${color}3f`, backgroundColor: `${color}12` }]}>
        <View style={sigilStyles.bodyBackdrop} />
        <View style={sigilStyles.railRow}>
          <View style={[sigilStyles.rail, { backgroundColor: `${color}30` }]} />
          <View style={[sigilStyles.coreHalo, { backgroundColor: `${color}16`, borderColor: `${color}42` }]}>
            <View style={sigilStyles.monogramWrap}>
              <View style={[sigilStyles.monogramStroke, sigilStyles.monogramLeft, { backgroundColor: color }]} />
              <View style={[sigilStyles.monogramStroke, sigilStyles.monogramRight, { backgroundColor: color }]} />
              <View style={[sigilStyles.monogramCrossbar, { backgroundColor: color }]} />
            </View>
          </View>
          <View style={[sigilStyles.rail, { backgroundColor: `${color}30` }]} />
        </View>
        <View style={sigilStyles.lowerRow}>
          <View style={[sigilStyles.lowerWing, sigilStyles.lowerWingLeft, { borderTopColor: `${color}66` }]} />
          <View style={[sigilStyles.keystone, { backgroundColor: color }]} />
          <View style={[sigilStyles.lowerWing, sigilStyles.lowerWingRight, { borderTopColor: `${color}66` }]} />
        </View>
      </View>

      <View style={sigilStyles.baseWrap}>
        <View style={[sigilStyles.baseRail, { backgroundColor: `${color}40` }]} />
        <View style={[sigilStyles.base, { borderColor: `${color}48`, backgroundColor: `${color}0f` }]}>
          <View style={[sigilStyles.baseInset, { backgroundColor: `${color}18` }]} />
        </View>
        <View style={[sigilStyles.baseRail, { backgroundColor: `${color}40` }]} />
      </View>
    </Animated.View>
  );
}

const sigilStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  crownWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 6,
  },
  crownSide: {
    width: 18,
    height: 8,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  crownGem: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  body: {
    width: 76,
    height: 84,
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 11,
    paddingBottom: 9,
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  bodyBackdrop: {
    position: 'absolute',
    top: -10,
    width: 70,
    height: 46,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  rail: {
    width: 3,
    height: 34,
    borderRadius: 999,
  },
  coreHalo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramWrap: {
    width: 22,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramStroke: {
    position: 'absolute',
    width: 3,
    height: 18,
    borderRadius: 999,
  },
  monogramLeft: {
    transform: [{ rotate: '-22deg' }, { translateX: -5 }],
  },
  monogramRight: {
    transform: [{ rotate: '22deg' }, { translateX: 5 }],
  },
  monogramCrossbar: {
    position: 'absolute',
    width: 12,
    height: 2.5,
    borderRadius: 999,
    top: 10,
  },
  lowerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  lowerWing: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  lowerWingLeft: {
    transform: [{ rotate: '14deg' }],
  },
  lowerWingRight: {
    transform: [{ rotate: '-14deg' }],
  },
  keystone: {
    width: 7,
    height: 7,
    borderRadius: 2,
  },
  baseWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 7,
  },
  baseRail: {
    width: 12,
    height: 2,
    borderRadius: 999,
  },
  base: {
    width: 28,
    height: 12,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  baseInset: {
    width: 15,
    height: 3,
    borderRadius: 999,
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
