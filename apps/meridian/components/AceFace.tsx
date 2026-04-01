/**
 * AceFace — Ace's conversational avatar.
 *
 * Replaces the hold-to-talk orb. A minimal geometric face lives on screen
 * and changes expression based on what Ace is doing. Tap to speak, tap to stop.
 * After Ace responds the face auto-listens — no button mechanic needed.
 *
 * Inspired by NS-5 (I, Robot): not a cartoon, not a human — just enough geometry
 * to feel alive and present.
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Pressable, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import type { AppPhase } from '../lib/store';

interface Props {
  phase: AppPhase;
  isSpeaking: boolean;
  onPress?: () => void;
  disabled?: boolean;
}

// ── Palette (matches OrbAnimation / icon.svg) ────────────────────────────────

const GLASS_BODY   = '#313946';
const GLASS_RING   = 'rgba(226, 242, 255, 0.82)';
const SILVER       = 'rgba(244, 248, 252, 0.98)';

const GLOW_COLOR: Record<AppPhase, string> = {
  idle:       '#b9d8f2',
  listening:  '#c7e7ff',
  thinking:   '#8bc8ff',
  confirming: '#e2c89c',
  hiring:     '#8bc8ff',
  executing:  '#b9d8f2',
  done:       '#b8d6bf',
  error:      '#f87171',
};

const BODY_GRADIENT: Record<AppPhase, [string, string]> = {
  idle:       ['#1e2832', '#2f3f50'],
  listening:  ['#1a2d3e', '#2e4258'],
  thinking:   ['#141e2e', '#1e3248'],
  confirming: ['#2a2010', '#4a3820'],
  hiring:     ['#141e2e', '#1e3248'],
  executing:  ['#1e2832', '#2f3f50'],
  done:       ['#122018', '#1e3828'],
  error:      ['#2e0808', '#5a1010'],
};

function baseMouthScaleForPhase(phase: AppPhase): number {
  switch (phase) {
    case 'listening':
      return 34 / 28;
    case 'thinking':
    case 'hiring':
    case 'executing':
      return 22 / 28;
    case 'confirming':
      return 26 / 28;
    case 'done':
      return 52 / 28;
    case 'error':
      return 20 / 28;
    case 'idle':
    default:
      return 1;
  }
}

function baseMouthOpacityForPhase(phase: AppPhase): number {
  switch (phase) {
    case 'listening':
      return 0.7;
    case 'thinking':
    case 'hiring':
    case 'executing':
      return 0.4;
    case 'confirming':
      return 0.55;
    case 'done':
      return 0.85;
    case 'error':
      return 0.6;
    case 'idle':
    default:
      return 0.5;
  }
}

// ── Sizes ─────────────────────────────────────────────────────────────────────

const FACE_W    = 160;
const FACE_H    = 200;
const GLOW_W    = 280;
const GLOW_H    = 320;
const RING_SIZE = 200;
const EYE_W     = 26;
const EYE_H     = 14;
const EYE_GAP   = 46;   // centre-to-centre horizontal
const EYE_Y     = -28;  // offset from face centre (upward)
const MOUTH_H   = 5;
const MOUTH_Y   = 32;   // offset from face centre (downward)

// ── Component ─────────────────────────────────────────────────────────────────

export function AceFace({ phase, isSpeaking, onPress, disabled }: Props) {
  // Glow
  const glowScale   = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.28)).current;

  // Rings (listening pulse)
  const ring1Scale   = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale   = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;

  // Eyes
  const eyeScaleY    = useRef(new Animated.Value(1)).current;   // blink
  const eyeTranslateX = useRef(new Animated.Value(0)).current;  // gaze drift

  // Face lift / breathe
  const faceScale  = useRef(new Animated.Value(1)).current;
  const faceLift   = useRef(new Animated.Value(0)).current;

  // Mouth
  const mouthScaleX  = useRef(new Animated.Value(1)).current;
  const mouthOpacity = useRef(new Animated.Value(0.6)).current;
  const speechMouthLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const glowColor = GLOW_COLOR[phase] ?? '#b9d8f2';

  // ── Phase animations ────────────────────────────────────────────────────────

  useEffect(() => {
    // Stop everything cleanly
    [glowScale, glowOpacity, ring1Scale, ring1Opacity, ring2Scale, ring2Opacity,
      eyeScaleY, eyeTranslateX, faceScale, faceLift, mouthScaleX, mouthOpacity]
      .forEach((v) => v.stopAnimation());

    if (phase === 'idle') {
      // Slow breath glow
      Animated.loop(Animated.sequence([
        Animated.timing(glowScale,   { toValue: 1.1,  duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glowScale,   { toValue: 1,    duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();
      Animated.loop(Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 0.42, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0.18, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      // Slow blink every ~4s
      Animated.loop(Animated.sequence([
        Animated.delay(3200),
        Animated.timing(eyeScaleY, { toValue: 0.12, duration: 90,  useNativeDriver: true }),
        Animated.timing(eyeScaleY, { toValue: 1,    duration: 110, useNativeDriver: true }),
      ])).start();

      // Very gentle gaze drift
      Animated.loop(Animated.sequence([
        Animated.timing(eyeTranslateX, { toValue: -3, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(eyeTranslateX, { toValue:  3, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(eyeTranslateX, { toValue:  0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      // Subtle float
      Animated.loop(Animated.sequence([
        Animated.timing(faceLift, { toValue: -4, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(faceLift, { toValue:  0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      // Mouth: thin closed line
      Animated.timing(mouthScaleX,  { toValue: 1, duration: 300, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity, { toValue: 0.5, duration: 300, useNativeDriver: true }).start();
    }

    if (phase === 'listening') {
      // Pulse rings
      const pulse = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
        Animated.loop(Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(scale,   { toValue: 1.9, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0,   duration: 2000, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scale,   { toValue: 1,    duration: 0, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.28, duration: 0, useNativeDriver: true }),
          ]),
        ]));
      pulse(ring1Scale, ring1Opacity, 0).start();
      pulse(ring2Scale, ring2Opacity, 1000).start();

      // Eyes wide, gaze side-to-side attentively
      Animated.timing(eyeScaleY, { toValue: 1.25, duration: 250, useNativeDriver: true }).start();
      Animated.loop(Animated.sequence([
        Animated.timing(eyeTranslateX, { toValue: -4, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(eyeTranslateX, { toValue:  4, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(eyeTranslateX, { toValue:  0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      Animated.timing(glowOpacity, { toValue: 0.55, duration: 400, useNativeDriver: true }).start();
      Animated.loop(Animated.sequence([
        Animated.timing(faceScale, { toValue: 1.04, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(faceScale, { toValue: 1,    duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      // Mouth slightly parted
      Animated.timing(mouthScaleX,  { toValue: 34 / 28, duration: 250, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity, { toValue: 0.7, duration: 250, useNativeDriver: true }).start();
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      // Eyes look slightly up
      Animated.timing(eyeScaleY,     { toValue: 1,  duration: 200, useNativeDriver: true }).start();
      Animated.timing(eyeTranslateX, { toValue: 0,  duration: 200, useNativeDriver: true }).start();

      // Slow thoughtful blink
      Animated.loop(Animated.sequence([
        Animated.delay(1800),
        Animated.timing(eyeScaleY, { toValue: 0.15, duration: 100, useNativeDriver: true }),
        Animated.timing(eyeScaleY, { toValue: 1,    duration: 130, useNativeDriver: true }),
      ])).start();

      // Faster glow pulse
      Animated.loop(Animated.sequence([
        Animated.timing(glowScale,   { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glowScale,   { toValue: 1,    duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();
      Animated.loop(Animated.sequence([
        Animated.timing(faceLift, { toValue: -3, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(faceLift, { toValue:  0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      // Mouth closed
      Animated.timing(mouthScaleX,  { toValue: 22 / 28, duration: 200, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity, { toValue: 0.4, duration: 200, useNativeDriver: true }).start();
    }

    if (phase === 'confirming') {
      // Steady forward gaze — attentive, waiting
      Animated.timing(eyeScaleY,     { toValue: 1,  duration: 250, useNativeDriver: true }).start();
      Animated.timing(eyeTranslateX, { toValue: 0,  duration: 250, useNativeDriver: true }).start();
      Animated.timing(glowOpacity,   { toValue: 0.45, duration: 400, useNativeDriver: true }).start();
      Animated.timing(mouthScaleX,   { toValue: 26 / 28, duration: 250, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity,  { toValue: 0.55, duration: 250, useNativeDriver: true }).start();
    }

    if (phase === 'done') {
      // Eyes curve upward — happiness illusion via scaleY compress + borderRadius
      Animated.spring(eyeScaleY, { toValue: 0.55, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
      Animated.timing(eyeTranslateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      Animated.spring(faceScale,  { toValue: 1.06, useNativeDriver: true, speed: 24 }).start();
      Animated.spring(faceLift,   { toValue: -5,   useNativeDriver: true, speed: 18, bounciness: 8 }).start();
      Animated.timing(glowOpacity,  { toValue: 0.6,  duration: 400, useNativeDriver: true }).start();
      // Mouth widens into a subtle smile bar
      Animated.spring(mouthScaleX, { toValue: 52 / 28, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
      Animated.timing(mouthOpacity, { toValue: 0.85, duration: 300, useNativeDriver: true }).start();
    }

    if (phase === 'error') {
      Animated.timing(eyeScaleY,     { toValue: 0.65, duration: 200, useNativeDriver: true }).start();
      Animated.timing(eyeTranslateX, { toValue: 0,    duration: 200, useNativeDriver: true }).start();
      Animated.timing(glowOpacity,   { toValue: 0.5,  duration: 300, useNativeDriver: true }).start();
      Animated.timing(mouthScaleX,   { toValue: 20 / 28, duration: 200, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity,  { toValue: 0.6, duration: 200, useNativeDriver: true }).start();
    }

    // Reset rings when not listening
    if (phase !== 'listening') {
      ring1Scale.setValue(1); ring1Opacity.setValue(0);
      ring2Scale.setValue(1); ring2Opacity.setValue(0);
    }
    if (phase !== 'thinking' && phase !== 'hiring' && phase !== 'executing') {
      Animated.spring(faceScale, { toValue: 1, useNativeDriver: true, speed: 14 }).start();
    }
    if (phase !== 'idle') {
      faceLift.stopAnimation();
      Animated.spring(faceLift, { toValue: 0, useNativeDriver: true, speed: 14 }).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Speaking mouth animation ─────────────────────────────────────────────────

  useEffect(() => {
    speechMouthLoopRef.current?.stop();
    speechMouthLoopRef.current = null;

    if (isSpeaking) {
      const mouthLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouthScaleX, { toValue: 52 / 28, duration: 160, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mouthScaleX, { toValue: 22 / 28, duration: 160, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mouthScaleX, { toValue: 44 / 28, duration: 140, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mouthScaleX, { toValue: 18 / 28, duration: 180, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      speechMouthLoopRef.current = mouthLoop;
      mouthLoop.start();
      Animated.timing(mouthOpacity, { toValue: 0.9, duration: 200, useNativeDriver: true }).start();
    } else {
      Animated.timing(mouthScaleX, {
        toValue: baseMouthScaleForPhase(phase),
        duration: 250,
        useNativeDriver: true,
      }).start();
      Animated.timing(mouthOpacity, {
        toValue: baseMouthOpacityForPhase(phase),
        duration: 220,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      speechMouthLoopRef.current?.stop();
      speechMouthLoopRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpeaking, phase]);

  // ── Interaction ──────────────────────────────────────────────────────────────

  const isInteractive = phase === 'idle' || phase === 'listening' || phase === 'thinking'
    || phase === 'hiring' || phase === 'executing' || phase === 'confirming' || phase === 'error';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const bodyColors = BODY_GRADIENT[phase];

  return (
    <View style={styles.container}>
      {/* Outer glow halo */}
      <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}>
        <LinearGradient
          colors={[glowColor, 'transparent']}
          style={styles.glowGrad}
        />
      </Animated.View>

      {/* Listening pulse rings */}
      <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity, borderColor: glowColor }]} />
      <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity, borderColor: glowColor }]} />

      {/* Face body */}
      <Animated.View style={{ transform: [{ scale: faceScale }, { translateY: faceLift }] }}>
        <Pressable onPress={handlePress} disabled={disabled || !isInteractive}>
          <LinearGradient
            colors={bodyColors}
            style={[styles.face, { shadowColor: glowColor }]}
          >
            {/* Glass sheen */}
            <LinearGradient
              colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']}
              start={{ x: 0.18, y: 0 }}
              end={{ x: 0.72, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />

            {/* Eyes */}
            <View style={styles.eyeRow}>
              <Animated.View
                style={[
                  styles.eye,
                  {
                    transform: [
                      { scaleY: eyeScaleY },
                      { translateX: eyeTranslateX },
                    ],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.eye,
                  {
                    transform: [
                      { scaleY: eyeScaleY },
                      { translateX: eyeTranslateX },
                    ],
                  },
                ]}
              />
            </View>

            {/* Mouth */}
            <Animated.View
              style={[
                styles.mouth,
                {
                  opacity: mouthOpacity,
                  transform: [{ scaleX: mouthScaleX }],
                },
              ]}
            />
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: GLOW_W,
    height: GLOW_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: GLOW_W,
    height: GLOW_H,
    borderRadius: GLOW_W / 2,
    overflow: 'hidden',
  },
  glowGrad: {
    flex: 1,
    borderRadius: GLOW_W / 2,
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1.2,
  },
  face: {
    width: FACE_W,
    height: FACE_H,
    borderRadius: FACE_W * 0.52,
    borderWidth: 1.2,
    borderColor: GLASS_RING,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 14,
    overflow: 'hidden',
  },
  eyeRow: {
    flexDirection: 'row',
    gap: EYE_GAP - EYE_W,   // gap between eyes
    marginTop: EYE_Y + FACE_H / 2 - EYE_H / 2 - FACE_H / 2 + 20,
    position: 'absolute',
    top: FACE_H / 2 + EYE_Y - EYE_H / 2,
  },
  eye: {
    width: EYE_W,
    height: EYE_H,
    borderRadius: EYE_H / 2,
    backgroundColor: SILVER,
  },
  mouth: {
    position: 'absolute',
    top: FACE_H / 2 + MOUTH_Y - MOUTH_H / 2,
    height: MOUTH_H,
    borderRadius: MOUTH_H / 2,
    backgroundColor: SILVER,
  },
});
