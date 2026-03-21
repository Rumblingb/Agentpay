/**
 * OrbAnimation — the Bro concierge orb
 *
 * Character: compass needle — travel's original instrument.
 * The needle tells the story of every phase:
 *   idle       → oscillates ±15°, searching the horizon
 *   listening  → rapid quiver — picking up your signal
 *   thinking   → clockwise spin — plotting your route
 *   confirming → slow tremble — the weight of a booking
 *   done       → snaps North with bounce — you're on your way
 *   error      → settles South (180°) — recalibrating
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
  /** Tap-to-toggle mode */
  onPress?: () => void;
  /** Hold-to-talk mode */
  onPressIn?: () => void;
  onPressOut?: () => void;
  disabled?: boolean;
}

const PHASE_COLORS: Record<AppPhase, [string, string]> = {
  idle:       ['#052e16', '#064e3b'],   // emerald — brand at rest
  listening:  ['#053530', '#065f46'],   // deep emerald — signal coming in
  thinking:   ['#0c2240', '#1e3a5f'],   // dark navy — AI processing
  choosing:   ['#052e16', '#064e3b'],   // emerald — assessing
  confirming: ['#451a03', '#92400e'],   // amber — weight of payment
  hiring:     ['#0c2240', '#1e3a5f'],   // navy — executing hire
  executing:  ['#052e16', '#064e3b'],   // emerald — doing the work
  done:       ['#052e16', '#14532d'],   // rich green — confirmed
  error:      ['#450a0a', '#7f1d1d'],   // red — recalibrating
};

// The bright (North) tip colour of the needle
const NEEDLE_COLOR: Record<AppPhase, string> = {
  idle:       '#34d399',  // emerald — searching the horizon
  listening:  '#6ee7b7',  // bright emerald — picking up signal
  thinking:   '#38bdf8',  // sky — plotting the route
  choosing:   '#34d399',  // emerald
  confirming: '#fcd34d',  // amber — the weight of a booking
  hiring:     '#38bdf8',  // sky
  executing:  '#34d399',  // emerald
  done:       '#4ade80',  // green — you're on your way
  error:      '#f87171',  // red — recalibrating
};

export function OrbAnimation({ phase, onPress, onPressIn, onPressOut, disabled }: Props) {
  const glowScale    = useRef(new Animated.Value(1)).current;
  const glowOpacity  = useRef(new Animated.Value(0.3)).current;
  const ring1Scale   = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale   = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const orbScale     = useRef(new Animated.Value(1)).current;
  const needleRot    = useRef(new Animated.Value(0)).current;

  const colors      = PHASE_COLORS[phase];
  const needleColor = NEEDLE_COLOR[phase];
  const shadowColor = PHASE_SHADOW[phase] ?? '#10b981';

  useEffect(() => {
    // Stop all running animations
    glowScale.stopAnimation();
    glowOpacity.stopAnimation();
    ring1Scale.stopAnimation();
    ring1Opacity.stopAnimation();
    ring2Scale.stopAnimation();
    ring2Opacity.stopAnimation();
    needleRot.stopAnimation();

    // Reset needle for phases that start fresh — let done/error animate from wherever they are
    if (phase !== 'done' && phase !== 'error') {
      needleRot.setValue(0);
    }

    // ── Idle ──────────────────────────────────────────────────────────────────
    if (phase === 'idle') {
      // Glow breathes slowly
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
      // Needle oscillates ±15° — searching the horizon
      Animated.loop(
        Animated.sequence([
          Animated.timing(needleRot, { toValue: -15, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(needleRot, { toValue: 15,  duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
    }

    // ── Listening ─────────────────────────────────────────────────────────────
    if (phase === 'listening') {
      // Halo rings bloom outward
      const breathe = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scale,   { toValue: 1.9, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0,   duration: 2200, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(scale,   { toValue: 1,    duration: 0, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.35, duration: 0, useNativeDriver: true }),
            ]),
          ]),
        );
      breathe(ring1Scale, ring1Opacity, 0).start();
      breathe(ring2Scale, ring2Opacity, 1100).start();
      // Orb gentle inhale
      Animated.loop(
        Animated.sequence([
          Animated.timing(orbScale, { toValue: 1.05, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(orbScale, { toValue: 1.0,  duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
      Animated.timing(glowOpacity, { toValue: 0.65, duration: 600, useNativeDriver: true }).start();
      // Needle quivers rapidly — picking up your signal
      Animated.loop(
        Animated.sequence([
          Animated.timing(needleRot, { toValue: -8, duration: 85, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(needleRot, { toValue: 8,  duration: 85, easing: Easing.linear, useNativeDriver: true }),
        ]),
      ).start();
    }

    // ── Thinking / Hiring / Executing ─────────────────────────────────────────
    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      // Glow pulses
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowScale, { toValue: 1.1, duration: 1200, useNativeDriver: true }),
          Animated.timing(glowScale, { toValue: 1.0, duration: 1200, useNativeDriver: true }),
        ]),
      ).start();
      // Needle spins clockwise — plotting your route
      Animated.loop(
        Animated.timing(needleRot, { toValue: 360, duration: 2400, easing: Easing.linear, useNativeDriver: true }),
      ).start();
    }

    // ── Confirming ────────────────────────────────────────────────────────────
    if (phase === 'confirming') {
      // Needle trembles — the weight of a booking
      Animated.loop(
        Animated.sequence([
          Animated.timing(needleRot, { toValue: -5, duration: 200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(needleRot, { toValue: 5,  duration: 200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
    }

    // ── Done ──────────────────────────────────────────────────────────────────
    if (phase === 'done') {
      // Orb bounces
      Animated.sequence([
        Animated.spring(orbScale, { toValue: 1.2, useNativeDriver: true, speed: 30 }),
        Animated.spring(orbScale, { toValue: 1.0, useNativeDriver: true, speed: 10 }),
      ]).start();
      // Needle snaps North — you're on your way
      Animated.spring(needleRot, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
    }

    // ── Error ─────────────────────────────────────────────────────────────────
    if (phase === 'error') {
      // Needle droops South — recalibrating
      Animated.spring(needleRot, { toValue: 180, useNativeDriver: true, speed: 8, bounciness: 4 }).start();
    }

    // Reset orbScale and rings for non-special phases
    if (phase !== 'listening' && phase !== 'done') {
      Animated.spring(orbScale, { toValue: 1, useNativeDriver: true, speed: 15 }).start();
      Animated.timing(glowOpacity, { toValue: phase === 'idle' ? 0.3 : 0.2, duration: 400, useNativeDriver: true }).start();
      ring1Scale.setValue(1);  ring1Opacity.setValue(0);
      ring2Scale.setValue(1);  ring2Opacity.setValue(0);
    }
  }, [phase]);

  // Linear interpolation covers both oscillation (-15→15) and full spin (0→360)
  const needleRotDeg = needleRot.interpolate({
    inputRange:  [-360, 360],
    outputRange: ['-360deg', '360deg'],
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

  // Done + error: show a clear status icon instead of compass
  const showStatusIcon = phase === 'done' || phase === 'error';

  return (
    <View style={styles.container}>
      {/* Outer glow */}
      <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}>
        <LinearGradient colors={[colors[1], 'transparent']} style={styles.glowGrad} />
      </Animated.View>

      {/* Listening halo rings */}
      <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
      <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />

      {/* Main orb */}
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
              <CompassNeedle rotation={needleRotDeg} color={needleColor} />
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ── Compass needle ────────────────────────────────────────────────────────────
// Two triangular tips (North bright, South muted) around a circular pivot.
// Entirely View-based — no SVG dependency.

const NORTH_H  = 26;
const SOUTH_H  = 17;
const NEEDLE_W = 6;
const PIVOT_R  = 4;

function CompassNeedle({
  rotation,
  color,
}: {
  rotation: Animated.AnimatedInterpolation<string>;
  color: string;
}) {
  return (
    <Animated.View style={[compassStyles.wrap, { transform: [{ rotate: rotation }] }]}>
      {/* North tip — bright, phase-tinted */}
      <View style={[compassStyles.tipNorth, { borderBottomColor: color }]} />
      {/* Pivot */}
      <View style={[compassStyles.pivot, { backgroundColor: color }]} />
      {/* South tip — always muted */}
      <View style={[compassStyles.tipSouth, { borderTopColor: 'rgba(255,255,255,0.22)' }]} />
    </Animated.View>
  );
}

const compassStyles = StyleSheet.create({
  wrap: {
    width:  NEEDLE_W,
    height: NORTH_H + PIVOT_R * 2 + SOUTH_H,
    alignItems: 'center',
  },
  tipNorth: {
    width: 0,
    height: 0,
    borderLeftWidth:   NEEDLE_W / 2,
    borderRightWidth:  NEEDLE_W / 2,
    borderBottomWidth: NORTH_H,
    borderLeftColor:   'transparent',
    borderRightColor:  'transparent',
    // borderBottomColor provided via prop
  },
  pivot: {
    width:        PIVOT_R * 2,
    height:       PIVOT_R * 2,
    borderRadius: PIVOT_R,
    // backgroundColor provided via prop
  },
  tipSouth: {
    width: 0,
    height: 0,
    borderLeftWidth:  NEEDLE_W / 2,
    borderRightWidth: NEEDLE_W / 2,
    borderTopWidth:   SOUTH_H,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    // borderTopColor provided via prop
  },
});

// ── Orb styles ────────────────────────────────────────────────────────────────

const ORB_SIZE  = 120;
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
    position:     'absolute',
    width:        GLOW_SIZE,
    height:       GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    overflow:     'hidden',
  },
  glowGrad: {
    flex:         1,
    borderRadius: GLOW_SIZE / 2,
  },
  ring: {
    position:     'absolute',
    width:        RING_SIZE,
    height:       RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth:  1.5,
    borderColor:  '#10b981',   // emerald rings
  },
  orb: {
    width:          ORB_SIZE,
    height:         ORB_SIZE,
    borderRadius:   ORB_SIZE / 2,
    alignItems:     'center',
    justifyContent: 'center',
    // shadowColor is injected dynamically via inline style
    shadowOffset:   { width: 0, height: 0 },
    shadowOpacity:  0.65,
    shadowRadius:   32,
    elevation:      15,
  },
});
