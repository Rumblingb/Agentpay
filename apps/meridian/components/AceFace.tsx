/**
 * AceFace — Ace's conversational avatar.
 *
 * A minimal but real-feeling face. Dark glass oval, two eyes with pupils
 * that move and blink, a mouth that animates when speaking.
 * Tap once to start — or opens automatically on mount (always-on mode).
 *
 * All animations use useNativeDriver: true (iOS + Android safe).
 * No SVG, no external animation libraries.
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

// ── Palette — matches Ace's existing dark steel aesthetic ─────────────────────

const FACE_BORDER    = 'rgba(200, 225, 255, 0.55)';
const FACE_SHEEN     = 'rgba(255,255,255,0.08)';
const EYE_WHITE      = 'rgba(230, 245, 255, 0.96)';
const PUPIL_COLOR    = '#0e1a28';
const MOUTH_COLOR    = 'rgba(220, 240, 255, 0.85)';

const GLOW_COLOR: Record<AppPhase, string> = {
  idle:       '#7ab8e8',
  listening:  '#c7e7ff',
  thinking:   '#6aaee0',
  confirming: '#d4b896',
  hiring:     '#6aaee0',
  executing:  '#7ab8e8',
  done:       '#8ecfa0',
  error:      '#e87a7a',
};

const FACE_GRADIENT: Record<AppPhase, [string, string]> = {
  idle:       ['#1a2535', '#0e1720'],
  listening:  ['#1d2e42', '#0f1e2e'],
  thinking:   ['#141e2e', '#0a1520'],
  confirming: ['#28200f', '#1a150a'],
  hiring:     ['#141e2e', '#0a1520'],
  executing:  ['#1a2535', '#0e1720'],
  done:       ['#152418', '#0a1810'],
  error:      ['#2a0e0e', '#1a0808'],
};

// ── Dimensions ─────────────────────────────────────────────────────────────────

const FACE_W    = 152;
const FACE_H    = 192;
const GLOW_W    = 270;
const GLOW_H    = 310;
const RING_SIZE = 190;

// Eye
const EYE_W     = 30;
const EYE_H     = 16;
const PUPIL_W   = 12;
const PUPIL_H   = 14;
const EYE_SEP   = 52;   // centre-to-centre

// Mouth
const MOUTH_BASE_W = 32;
const MOUTH_H      = 5;

// Vertical positions inside face (from top of face)
const EYES_TOP  = 72;
const MOUTH_TOP = 122;

function baseMouthScaleForPhase(phase: AppPhase): number {
  if (phase === 'done') return 1.8;
  if (phase === 'listening') return 1.2;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.75;
  if (phase === 'error') return 0.65;
  if (phase === 'confirming') return 0.9;
  return 1;
}

function baseMouthOpacityForPhase(phase: AppPhase): number {
  if (phase === 'listening') return 0.75;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.35;
  if (phase === 'confirming') return 0.55;
  if (phase === 'done') return 0.9;
  if (phase === 'error') return 0.55;
  return 0.55;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AceFace({ phase, isSpeaking, onPress, disabled }: Props) {
  const glowScale    = useRef(new Animated.Value(1)).current;
  const glowOpacity  = useRef(new Animated.Value(0.32)).current;
  const ring1Scale   = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale   = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;

  // Eyes
  const eyeScaleY    = useRef(new Animated.Value(1)).current;   // blink
  const pupilX       = useRef(new Animated.Value(0)).current;   // gaze left/right
  const pupilY       = useRef(new Animated.Value(0)).current;   // gaze up/down

  // Face
  const faceScale    = useRef(new Animated.Value(1)).current;
  const faceLift     = useRef(new Animated.Value(0)).current;

  // Mouth (scaleX on fixed base width — native driver safe)
  const mouthScaleX  = useRef(new Animated.Value(1)).current;
  const mouthOpacity = useRef(new Animated.Value(0.55)).current;
  const speechLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const speechBlinkLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const glowColor    = GLOW_COLOR[phase] ?? '#7ab8e8';
  const bodyColors   = FACE_GRADIENT[phase];

  // ── Phase expressions ────────────────────────────────────────────────────────

  useEffect(() => {
    [glowScale, glowOpacity, ring1Scale, ring1Opacity, ring2Scale, ring2Opacity,
      eyeScaleY, pupilX, pupilY, faceScale, faceLift, mouthScaleX, mouthOpacity]
      .forEach((v) => v.stopAnimation());

    if (phase === 'idle') {
      // Slow breath
      Animated.loop(Animated.sequence([
        Animated.timing(glowScale,   { toValue: 1.08, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glowScale,   { toValue: 1,    duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();
      Animated.loop(Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 0.48, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0.18, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      // Lazy blink every ~5s
      Animated.loop(Animated.sequence([
        Animated.delay(4200),
        Animated.timing(eyeScaleY, { toValue: 0.08, duration: 80,  useNativeDriver: true }),
        Animated.timing(eyeScaleY, { toValue: 1,    duration: 110, useNativeDriver: true }),
        Animated.delay(200),
        Animated.timing(eyeScaleY, { toValue: 0.08, duration: 70,  useNativeDriver: true }),
        Animated.timing(eyeScaleY, { toValue: 1,    duration: 100, useNativeDriver: true }),
      ])).start();

      // Gentle gaze wander
      Animated.loop(Animated.sequence([
        Animated.timing(pupilX, { toValue: -3, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pupilX, { toValue:  3, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pupilX, { toValue:  0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();
      Animated.loop(Animated.sequence([
        Animated.timing(pupilY, { toValue: -1.5, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pupilY, { toValue:  1.5, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      // Subtle float
      Animated.loop(Animated.sequence([
        Animated.timing(faceLift, { toValue: -3, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(faceLift, { toValue:  0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      Animated.timing(mouthScaleX,  { toValue: 1,    duration: 300, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity, { toValue: 0.55, duration: 300, useNativeDriver: true }).start();
    }

    if (phase === 'listening') {
      // Rings
      const ring = (s: Animated.Value, o: Animated.Value, delay: number) =>
        Animated.loop(Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(s, { toValue: 1.85, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(o, { toValue: 0,    duration: 1800, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(s, { toValue: 1,    duration: 0, useNativeDriver: true }),
            Animated.timing(o, { toValue: 0.28, duration: 0, useNativeDriver: true }),
          ]),
        ]));
      ring(ring1Scale, ring1Opacity, 0).start();
      ring(ring2Scale, ring2Opacity, 900).start();

      // Eyes open wide, pupils centre and alert
      Animated.timing(eyeScaleY, { toValue: 1.3, duration: 220, useNativeDriver: true }).start();
      Animated.timing(pupilX,    { toValue: 0,   duration: 220, useNativeDriver: true }).start();
      Animated.timing(pupilY,    { toValue: 0,   duration: 220, useNativeDriver: true }).start();

      Animated.timing(glowOpacity, { toValue: 0.65, duration: 350, useNativeDriver: true }).start();
      Animated.loop(Animated.sequence([
        Animated.timing(faceScale, { toValue: 1.03, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(faceScale, { toValue: 1,    duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      Animated.timing(mouthScaleX,  { toValue: 1.2,  duration: 220, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity, { toValue: 0.75, duration: 220, useNativeDriver: true }).start();
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      // Eyes half-closed, pupils look slightly up — thoughtful
      Animated.timing(eyeScaleY, { toValue: 0.75, duration: 300, useNativeDriver: true }).start();
      Animated.timing(pupilY,    { toValue: -2,   duration: 300, useNativeDriver: true }).start();
      Animated.timing(pupilX,    { toValue: 0,    duration: 300, useNativeDriver: true }).start();

      // Slow deliberate blink
      Animated.loop(Animated.sequence([
        Animated.delay(2200),
        Animated.timing(eyeScaleY, { toValue: 0.08, duration: 120, useNativeDriver: true }),
        Animated.timing(eyeScaleY, { toValue: 0.75, duration: 150, useNativeDriver: true }),
      ])).start();

      Animated.loop(Animated.sequence([
        Animated.timing(glowScale, { toValue: 1.06, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glowScale, { toValue: 1,    duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();
      Animated.loop(Animated.sequence([
        Animated.timing(faceLift, { toValue: -2, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(faceLift, { toValue:  0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])).start();

      Animated.timing(mouthScaleX,  { toValue: 0.75, duration: 250, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity, { toValue: 0.35, duration: 250, useNativeDriver: true }).start();
    }

    if (phase === 'confirming') {
      // Eyes fully open, direct gaze — awaiting decision
      Animated.timing(eyeScaleY, { toValue: 1,   duration: 250, useNativeDriver: true }).start();
      Animated.timing(pupilX,    { toValue: 0,   duration: 250, useNativeDriver: true }).start();
      Animated.timing(pupilY,    { toValue: 0,   duration: 250, useNativeDriver: true }).start();
      Animated.timing(glowOpacity, { toValue: 0.5, duration: 400, useNativeDriver: true }).start();
      Animated.timing(mouthScaleX,  { toValue: 0.9,  duration: 250, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity, { toValue: 0.55, duration: 250, useNativeDriver: true }).start();
    }

    if (phase === 'done') {
      // Eyes compress upward — satisfied expression
      Animated.spring(eyeScaleY, { toValue: 0.5, useNativeDriver: true, speed: 22, bounciness: 4 }).start();
      Animated.timing(pupilX,    { toValue: 0,   duration: 200, useNativeDriver: true }).start();
      Animated.timing(pupilY,    { toValue: 2,   duration: 200, useNativeDriver: true }).start();  // pupils slightly down (soft look)
      Animated.spring(faceScale, { toValue: 1.05, useNativeDriver: true, speed: 22 }).start();
      Animated.spring(faceLift,  { toValue: -4,   useNativeDriver: true, speed: 18, bounciness: 6 }).start();
      Animated.timing(glowOpacity, { toValue: 0.65, duration: 400, useNativeDriver: true }).start();
      // Mouth widens — subtle smile
      Animated.spring(mouthScaleX,  { toValue: 1.8, useNativeDriver: true, speed: 18, bounciness: 5 } as any).start();
      Animated.timing(mouthOpacity, { toValue: 0.9, duration: 300, useNativeDriver: true }).start();
    }

    if (phase === 'error') {
      // Eyes narrow, slight frown
      Animated.timing(eyeScaleY, { toValue: 0.6, duration: 200, useNativeDriver: true }).start();
      Animated.timing(pupilX,    { toValue: 0,   duration: 200, useNativeDriver: true }).start();
      Animated.timing(pupilY,    { toValue: 1,   duration: 200, useNativeDriver: true }).start();
      Animated.timing(glowOpacity, { toValue: 0.55, duration: 300, useNativeDriver: true }).start();
      Animated.timing(mouthScaleX,  { toValue: 0.65, duration: 200, useNativeDriver: true }).start();
      Animated.timing(mouthOpacity, { toValue: 0.55, duration: 200, useNativeDriver: true }).start();
    }

    if (phase !== 'listening') {
      ring1Scale.setValue(1); ring1Opacity.setValue(0);
      ring2Scale.setValue(1); ring2Opacity.setValue(0);
    }
    if (phase !== 'thinking' && phase !== 'hiring' && phase !== 'executing') {
      Animated.spring(faceScale, { toValue: 1, useNativeDriver: true, speed: 14 }).start();
    }
    if (phase === 'listening' || phase === 'idle') {
      Animated.spring(faceLift, { toValue: 0, useNativeDriver: true, speed: 14 }).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Speaking mouth ────────────────────────────────────────────────────────────

  useEffect(() => {
    speechLoopRef.current?.stop();
    speechLoopRef.current = null;
    speechBlinkLoopRef.current?.stop();
    speechBlinkLoopRef.current = null;

    if (isSpeaking) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(mouthScaleX, { toValue: 1.9,  duration: 140, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(mouthScaleX, { toValue: 0.7,  duration: 150, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(mouthScaleX, { toValue: 1.55, duration: 130, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(mouthScaleX, { toValue: 0.55, duration: 160, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      speechLoopRef.current = loop;
      loop.start();
      Animated.timing(mouthOpacity, { toValue: 0.95, duration: 180, useNativeDriver: true }).start();

      // Natural blink while speaking
      const blinkLoop = Animated.loop(Animated.sequence([
        Animated.delay(2600),
        Animated.timing(eyeScaleY, { toValue: 0.08, duration: 75,  useNativeDriver: true }),
        Animated.timing(eyeScaleY, { toValue: 1,    duration: 95,  useNativeDriver: true }),
      ]));
      speechBlinkLoopRef.current = blinkLoop;
      blinkLoop.start();
    } else {
      Animated.timing(mouthScaleX, {
        toValue: baseMouthScaleForPhase(phase),
        duration: 260,
        useNativeDriver: true,
      }).start();
      Animated.timing(mouthOpacity, {
        toValue: baseMouthOpacityForPhase(phase),
        duration: 220,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      speechLoopRef.current?.stop();
      speechLoopRef.current = null;
      speechBlinkLoopRef.current?.stop();
      speechBlinkLoopRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpeaking, phase]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const isInteractive = !['done'].includes(phase) || phase === 'error';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  return (
    <View style={styles.container}>
      {/* Glow halo */}
      <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}>
        <LinearGradient colors={[glowColor, 'transparent']} style={styles.glowGrad} />
      </Animated.View>

      {/* Listening rings */}
      <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity, borderColor: glowColor }]} />
      <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity, borderColor: glowColor }]} />

      {/* Face */}
      <Animated.View style={{ transform: [{ scale: faceScale }, { translateY: faceLift }] }}>
        <Pressable onPress={handlePress} disabled={disabled}>
          <LinearGradient colors={bodyColors} style={[styles.face, { shadowColor: glowColor }]}>
            {/* Top-left sheen */}
            <LinearGradient
              colors={[FACE_SHEEN, 'transparent']}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.7, y: 0.55 }}
              style={StyleSheet.absoluteFill}
            />

            {/* Left eye */}
            <View style={[styles.eyeContainer, { left: FACE_W / 2 - EYE_SEP / 2 - EYE_W / 2, top: EYES_TOP }]}>
              <Animated.View style={[styles.eyeWhite, { transform: [{ scaleY: eyeScaleY }] }]}>
                <Animated.View style={[styles.pupil, { transform: [{ translateX: pupilX }, { translateY: pupilY }] }]} />
              </Animated.View>
            </View>

            {/* Right eye */}
            <View style={[styles.eyeContainer, { left: FACE_W / 2 + EYE_SEP / 2 - EYE_W / 2, top: EYES_TOP }]}>
              <Animated.View style={[styles.eyeWhite, { transform: [{ scaleY: eyeScaleY }] }]}>
                <Animated.View style={[styles.pupil, { transform: [{ translateX: pupilX }, { translateY: pupilY }] }]} />
              </Animated.View>
            </View>

            {/* Mouth */}
            <Animated.View
              style={[
                styles.mouth,
                {
                  left: FACE_W / 2 - MOUTH_BASE_W / 2,
                  top: MOUTH_TOP,
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
    borderRadius: FACE_W * 0.5,   // tall oval
    borderWidth: 1,
    borderColor: FACE_BORDER,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 26,
    elevation: 14,
    overflow: 'hidden',
  },
  eyeContainer: {
    position: 'absolute',
    width: EYE_W,
    height: EYE_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeWhite: {
    width: EYE_W,
    height: EYE_H,
    borderRadius: EYE_H / 2,
    backgroundColor: EYE_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#c8e8ff',
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  pupil: {
    width: PUPIL_W,
    height: PUPIL_H,
    borderRadius: PUPIL_W / 2,
    backgroundColor: PUPIL_COLOR,
  },
  mouth: {
    position: 'absolute',
    width: MOUTH_BASE_W,
    height: MOUTH_H,
    borderRadius: MOUTH_H / 2,
    backgroundColor: MOUTH_COLOR,
  },
});
