/**
 * OrbAnimation - Ace's first-launch presence
 *
 * Onboarding should feel like the same calm, voice-first Ace that lives in the
 * main app. The sigil is the object; the stage only adds atmosphere.
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Pressable, Easing, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { AppPhase } from '../lib/store';

interface Props {
  phase: AppPhase;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
}

const MARK_ASSET = require('../assets/ace-mark.png');
const STATE_ORB_SIZE = 118;
const GLOW_SIZE = 206;
const RING_SIZE = 132;

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

const SHADOW_COLOR: Record<AppPhase, string> = {
  idle: '#b9d8f2',
  listening: '#c7e7ff',
  thinking: '#8bc8ff',
  confirming: '#e2c89c',
  hiring: '#8bc8ff',
  executing: '#b9d8f2',
  done: '#b8d6bf',
  error: '#f87171',
};

const STATE_COLORS: Record<AppPhase, [string, string]> = {
  idle: ['#151b23', '#2f3945'],
  listening: ['#19212a', '#34414d'],
  thinking: ['#0f1722', '#243548'],
  confirming: ['#1f1a15', '#4d4030'],
  hiring: ['#0f1722', '#243548'],
  executing: ['#151b23', '#2f3945'],
  done: ['#162017', '#334337'],
  error: ['#450a0a', '#7f1d1d'],
};

export function OrbAnimation({ phase, onPress, onPressIn, onPressOut, disabled }: Props) {
  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.2)).current;
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const orbScale = useRef(new Animated.Value(1)).current;
  const orbLift = useRef(new Animated.Value(0)).current;

  const accent = ACCENT_COLOR[phase];
  const shadowColor = SHADOW_COLOR[phase];
  const stateColors = STATE_COLORS[phase];

  useEffect(() => {
    glowScale.stopAnimation();
    glowOpacity.stopAnimation();
    ring1Scale.stopAnimation();
    ring1Opacity.stopAnimation();
    ring2Scale.stopAnimation();
    ring2Opacity.stopAnimation();
    orbScale.stopAnimation();
    orbLift.stopAnimation();

    const timing = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, {
        toValue,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });

    if (phase === 'idle') {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            timing(glowScale, 1.05, 2400),
            timing(glowOpacity, 0.3, 2400),
            timing(orbScale, 1.02, 2400),
            timing(orbLift, -2, 2400),
          ]),
          Animated.parallel([
            timing(glowScale, 1, 2400),
            timing(glowOpacity, 0.16, 2400),
            timing(orbScale, 1, 2400),
            timing(orbLift, 0, 2400),
          ]),
        ]),
      ).start();
    }

    if (phase === 'listening') {
      const pulse = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scale, {
                toValue: 1.78,
                duration: 1800,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(opacity, {
                toValue: 0,
                duration: 1800,
                easing: Easing.in(Easing.quad),
                useNativeDriver: true,
              }),
            ]),
            Animated.parallel([
              Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.22, duration: 0, useNativeDriver: true }),
            ]),
          ]),
        );

      pulse(ring1Scale, ring1Opacity, 0).start();
      pulse(ring2Scale, ring2Opacity, 900).start();

      Animated.loop(
        Animated.sequence([
          timing(orbScale, 1.035, 1100),
          timing(orbScale, 1, 1100),
        ]),
      ).start();
      Animated.loop(
        Animated.sequence([
          timing(glowScale, 1.08, 1100),
          timing(glowOpacity, 0.48, 1100),
          timing(glowScale, 1.02, 1100),
          timing(glowOpacity, 0.28, 1100),
        ]),
      ).start();
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            timing(glowScale, 1.08, 1000),
            timing(glowOpacity, 0.4, 1000),
            timing(orbLift, -3, 1000),
            timing(orbScale, 1.03, 1000),
          ]),
          Animated.parallel([
            timing(glowScale, 1.01, 1000),
            timing(glowOpacity, 0.22, 1000),
            timing(orbLift, 0, 1000),
            timing(orbScale, 1, 1000),
          ]),
        ]),
      ).start();
    }

    if (phase === 'confirming') {
      timing(glowOpacity, 0.24, 260).start();
      timing(glowScale, 1.02, 260).start();
      timing(orbScale, 1.01, 260).start();
    }

    if (phase === 'done') {
      Animated.sequence([
        Animated.spring(orbScale, { toValue: 1.08, useNativeDriver: true, speed: 24 }),
        Animated.spring(orbScale, { toValue: 1, useNativeDriver: true, speed: 12 }),
      ]).start();
      Animated.spring(orbLift, { toValue: -3, useNativeDriver: true, speed: 16, bounciness: 7 }).start();
      Animated.timing(glowOpacity, { toValue: 0.28, duration: 240, useNativeDriver: true }).start();
    }

    if (phase === 'error') {
      timing(glowOpacity, 0.18, 260).start();
      timing(glowScale, 1.01, 260).start();
    }

    if (phase !== 'listening') {
      ring1Scale.setValue(1);
      ring1Opacity.setValue(0);
      ring2Scale.setValue(1);
      ring2Opacity.setValue(0);
    }
  }, [glowOpacity, glowScale, orbLift, orbScale, phase, ring1Opacity, ring1Scale, ring2Opacity, ring2Scale]);

  const isInteractive = phase === 'idle' || phase === 'listening' || phase === 'confirming' || phase === 'error';

  const handlePress = () => {
    if (!disabled && isInteractive) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onPress?.();
    }
  };

  const handlePressIn = () => {
    if (!disabled && isInteractive && !onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onPressIn?.();
    }
  };

  const handlePressOut = () => {
    if (!disabled && isInteractive && !onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPressOut?.();
    }
  };

  const iconName = phase === 'done' ? 'checkmark' : 'warning-outline';
  const iconColor = phase === 'done' ? '#d8eadc' : '#f2b2b2';

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}>
        <LinearGradient colors={[shadowColor, 'rgba(0,0,0,0)']} style={styles.glowGrad} />
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
          {phase === 'done' || phase === 'error' ? (
            <LinearGradient colors={stateColors} style={[styles.stateOrb, { shadowColor }]}>
              <Ionicons name={iconName as any} size={38} color={iconColor} />
            </LinearGradient>
          ) : (
            <View style={[styles.markWrap, { shadowColor }]}>
              <LinearGradient
                colors={['rgba(227, 241, 255, 0.12)', 'rgba(227, 241, 255, 0.03)', 'rgba(0,0,0,0)']}
                start={{ x: 0.25, y: 0.05 }}
                end={{ x: 0.85, y: 1 }}
                style={styles.stageAura}
              />
              <Image
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                source={MARK_ASSET}
                style={styles.markImage}
                resizeMode="contain"
              />
            </View>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

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
    borderWidth: 1,
  },
  stateOrb: {
    width: STATE_ORB_SIZE,
    height: STATE_ORB_SIZE,
    borderRadius: STATE_ORB_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(235, 244, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
  markWrap: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 10,
  },
  stageAura: {
    position: 'absolute',
    width: 172,
    height: 172,
    borderRadius: 999,
  },
  markImage: {
    width: 110,
    height: 110,
  },
});
