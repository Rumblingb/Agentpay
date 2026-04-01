/**
 * AceFace - Ace's conversational avatar.
 *
 * Premium, code-native face that stays inside the existing conversation-object
 * footprint. It should feel like a live presence, not a cartoon and not a
 * humanoid character. AceMark remains the permanent brand symbol elsewhere.
 */

import React, { useEffect, useMemo, useRef } from 'react';
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

const FACE_BORDER = 'rgba(200, 225, 255, 0.55)';
const FACE_INNER_BORDER = 'rgba(180, 220, 255, 0.12)';
const FACE_SHEEN = 'rgba(255,255,255,0.08)';
const EYE_WHITE = 'rgba(233, 245, 255, 0.96)';
const IRIS_COLOR = 'rgba(80,120,180,0.35)';
const PUPIL_COLOR = '#0e1a28';
const PUPIL_HIGHLIGHT = 'rgba(255,255,255,0.92)';
const MOUTH_COLOR = 'rgba(220, 240, 255, 0.86)';

const GLOW_COLOR: Record<AppPhase, string> = {
  idle: '#7ab8e8',
  listening: '#c7e7ff',
  thinking: '#6aaee0',
  confirming: '#d4b896',
  hiring: '#6aaee0',
  executing: '#7ab8e8',
  done: '#8ecfa0',
  error: '#e87a7a',
};

const FACE_GRADIENT: Record<AppPhase, [string, string]> = {
  idle: ['#1a2535', '#0e1720'],
  listening: ['#1d2e42', '#0f1e2e'],
  thinking: ['#141e2e', '#0a1520'],
  confirming: ['#28200f', '#1a150a'],
  hiring: ['#141e2e', '#0a1520'],
  executing: ['#1a2535', '#0e1720'],
  done: ['#152418', '#0a1810'],
  error: ['#2a0e0e', '#1a0808'],
};

const FACE_W = 152;
const FACE_H = 192;
const GLOW_W = 270;
const GLOW_H = 310;
const RING_SIZE = 190;

const EYE_W = 32;
const EYE_H = 18;
const EYE_SEP = 54;
const IRIS_W = 18;
const IRIS_H = 16;
const PUPIL_W = 10;
const PUPIL_H = 12;
const HIGHLIGHT_SIZE = 4;
const LID_H = EYE_H + 10;

const MOUTH_BASE_W = 34;
const MOUTH_H = 5;

const EYES_TOP = 72;
const MOUTH_TOP = 122;

function lidTranslateForCover(coverPx: number): number {
  return -LID_H + coverPx;
}

function baseLidCoverForPhase(phase: AppPhase): number {
  if (phase === 'listening') return 0.3;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 4.2;
  if (phase === 'confirming') return 1.5;
  if (phase === 'done') return 6.5;
  if (phase === 'error') return 5;
  return 0.8;
}

function baseGazeForPhase(phase: AppPhase): { x: number; y: number } {
  if (phase === 'listening') return { x: 0, y: 0 };
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return { x: 0, y: -1.8 };
  if (phase === 'done') return { x: 0, y: 1.6 };
  if (phase === 'error') return { x: 0, y: 0.8 };
  return { x: 0, y: 0 };
}

function basePupilScaleForPhase(phase: AppPhase): number {
  if (phase === 'listening') return 1.06;
  if (phase === 'error') return 0.9;
  return 1;
}

function baseMouthScaleForPhase(phase: AppPhase): number {
  if (phase === 'done') return 1.78;
  if (phase === 'listening') return 1.18;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.78;
  if (phase === 'error') return 0.66;
  if (phase === 'confirming') return 0.92;
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

function stopLoops(loops: Animated.CompositeAnimation[]) {
  for (const loop of loops) {
    loop.stop();
  }
}

export function AceFace({ phase, isSpeaking, onPress, disabled }: Props) {
  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.32)).current;
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;

  const leftLidY = useRef(new Animated.Value(lidTranslateForCover(baseLidCoverForPhase('idle')))).current;
  const rightLidY = useRef(new Animated.Value(lidTranslateForCover(baseLidCoverForPhase('idle')))).current;
  const gazeX = useRef(new Animated.Value(0)).current;
  const gazeY = useRef(new Animated.Value(0)).current;
  const speechGazeX = useRef(new Animated.Value(0)).current;
  const speechGazeY = useRef(new Animated.Value(0)).current;
  const pupilScale = useRef(new Animated.Value(1)).current;

  const faceScale = useRef(new Animated.Value(1)).current;
  const faceLift = useRef(new Animated.Value(0)).current;
  const mouthScaleX = useRef(new Animated.Value(1)).current;
  const mouthOpacity = useRef(new Animated.Value(0.55)).current;

  const phaseLoopsRef = useRef<Animated.CompositeAnimation[]>([]);
  const speechMouthLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const speechGazeLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const glowColor = GLOW_COLOR[phase] ?? '#7ab8e8';
  const bodyColors = FACE_GRADIENT[phase];
  const lidColor = bodyColors[0];
  const pupilRenderX = useMemo(() => Animated.add(gazeX, speechGazeX), [gazeX, speechGazeX]);
  const pupilRenderY = useMemo(() => Animated.add(gazeY, speechGazeY), [gazeY, speechGazeY]);

  useEffect(() => {
    stopLoops(phaseLoopsRef.current);
    phaseLoopsRef.current = [];

    [
      glowScale,
      glowOpacity,
      ring1Scale,
      ring1Opacity,
      ring2Scale,
      ring2Opacity,
      leftLidY,
      rightLidY,
      gazeX,
      gazeY,
      pupilScale,
      faceScale,
      faceLift,
      mouthScaleX,
      mouthOpacity,
    ].forEach((value) => value.stopAnimation());

    const loops: Animated.CompositeAnimation[] = [];
    const rememberLoop = (loop: Animated.CompositeAnimation) => {
      loops.push(loop);
      loop.start();
    };
    const animate = (value: Animated.Value, toValue: number, duration: number) =>
      Animated.timing(value, {
        toValue,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });

    const baseCover = baseLidCoverForPhase(phase);
    const baseLidValue = lidTranslateForCover(baseCover);
    const fullCloseValue = lidTranslateForCover(EYE_H + 4);
    const baseGaze = baseGazeForPhase(phase);

    animate(leftLidY, baseLidValue, 240).start();
    animate(rightLidY, baseLidValue, 240).start();
    animate(gazeX, baseGaze.x, 260).start();
    animate(gazeY, baseGaze.y, 260).start();
    animate(pupilScale, basePupilScaleForPhase(phase), 220).start();
    animate(mouthScaleX, baseMouthScaleForPhase(phase), 240).start();
    animate(mouthOpacity, baseMouthOpacityForPhase(phase), 220).start();

    ring1Scale.setValue(1);
    ring1Opacity.setValue(0);
    ring2Scale.setValue(1);
    ring2Opacity.setValue(0);

    if (phase === 'idle') {
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            animate(glowScale, 1.08, 3200),
            animate(glowScale, 1, 3200),
          ]),
        ),
      );
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            animate(glowOpacity, 0.48, 3200),
            animate(glowOpacity, 0.18, 3200),
          ]),
        ),
      );
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            Animated.delay(3600),
            Animated.parallel([animate(leftLidY, fullCloseValue, 90), animate(rightLidY, fullCloseValue, 90)]),
            Animated.parallel([animate(leftLidY, baseLidValue, 110), animate(rightLidY, baseLidValue, 110)]),
            Animated.delay(150),
            Animated.parallel([animate(leftLidY, fullCloseValue, 75), animate(rightLidY, fullCloseValue, 75)]),
            Animated.parallel([animate(leftLidY, baseLidValue, 100), animate(rightLidY, baseLidValue, 100)]),
          ]),
        ),
      );
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            animate(gazeX, -4, 2600),
            animate(gazeY, -1.8, 2200),
            animate(gazeX, 3.5, 2800),
            animate(gazeY, 1.5, 2200),
            animate(gazeX, 0, 2200),
            animate(gazeY, 0, 2200),
          ]),
        ),
      );
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            animate(faceLift, -3, 2600),
            animate(faceLift, 0, 2600),
          ]),
        ),
      );
    }

    if (phase === 'listening') {
      const ring1 = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Scale, { toValue: 1.82, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0, duration: 1800, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0.26, duration: 0, useNativeDriver: true }),
          ]),
        ]),
      );
      const ring2 = Animated.loop(
        Animated.sequence([
          Animated.delay(900),
          Animated.parallel([
            Animated.timing(ring2Scale, { toValue: 1.82, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0, duration: 1800, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring2Scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0.24, duration: 0, useNativeDriver: true }),
          ]),
        ]),
      );
      rememberLoop(ring1);
      rememberLoop(ring2);
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            animate(faceScale, 1.03, 1100),
            animate(faceScale, 1, 1100),
          ]),
        ),
      );
      animate(glowOpacity, 0.64, 350).start();
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            Animated.delay(2100),
            Animated.stagger(45, [animate(leftLidY, fullCloseValue, 110), animate(rightLidY, fullCloseValue, 110)]),
            Animated.stagger(35, [animate(leftLidY, baseLidValue, 145), animate(rightLidY, baseLidValue, 150)]),
          ]),
        ),
      );
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            animate(glowScale, 1.06, 1000),
            animate(glowScale, 1, 1000),
          ]),
        ),
      );
      rememberLoop(
        Animated.loop(
          Animated.sequence([
            animate(faceLift, -2, 900),
            animate(faceLift, 0, 900),
          ]),
        ),
      );
    }

    if (phase === 'confirming') {
      animate(glowOpacity, 0.5, 380).start();
    }

    if (phase === 'done') {
      Animated.spring(faceScale, {
        toValue: 1.05,
        useNativeDriver: true,
        speed: 22,
        bounciness: 4,
      }).start();
      Animated.spring(faceLift, {
        toValue: -4,
        useNativeDriver: true,
        speed: 18,
        bounciness: 6,
      }).start();
      animate(glowOpacity, 0.65, 380).start();
    }

    if (phase === 'error') {
      animate(glowOpacity, 0.56, 300).start();
    }

    phaseLoopsRef.current = loops;
    return () => {
      stopLoops(loops);
    };
  }, [
    faceLift,
    faceScale,
    gazeX,
    gazeY,
    glowOpacity,
    glowScale,
    leftLidY,
    mouthOpacity,
    mouthScaleX,
    phase,
    pupilScale,
    rightLidY,
    ring1Opacity,
    ring1Scale,
    ring2Opacity,
    ring2Scale,
  ]);

  useEffect(() => {
    speechMouthLoopRef.current?.stop();
    speechMouthLoopRef.current = null;
    speechGazeLoopRef.current?.stop();
    speechGazeLoopRef.current = null;

    if (isSpeaking) {
      const mouthLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouthScaleX, { toValue: 1.85, duration: 140, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mouthScaleX, { toValue: 0.8, duration: 150, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mouthScaleX, { toValue: 1.52, duration: 130, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(mouthScaleX, { toValue: 0.62, duration: 165, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      const gazeLoop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(speechGazeX, { toValue: -1, duration: 120, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(speechGazeY, { toValue: 0.4, duration: 120, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(speechGazeX, { toValue: 1, duration: 110, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(speechGazeY, { toValue: -0.4, duration: 110, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(speechGazeX, { toValue: 0, duration: 90, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(speechGazeY, { toValue: 0, duration: 90, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
          Animated.delay(340),
        ]),
      );
      speechMouthLoopRef.current = mouthLoop;
      speechGazeLoopRef.current = gazeLoop;
      mouthLoop.start();
      gazeLoop.start();
      Animated.timing(mouthOpacity, { toValue: 0.95, duration: 180, useNativeDriver: true }).start();
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
      Animated.timing(speechGazeX, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }).start();
      Animated.timing(speechGazeY, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      speechMouthLoopRef.current?.stop();
      speechMouthLoopRef.current = null;
      speechGazeLoopRef.current?.stop();
      speechGazeLoopRef.current = null;
    };
  }, [isSpeaking, mouthOpacity, mouthScaleX, phase, speechGazeX, speechGazeY]);

  const isInteractive = phase !== 'done';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.glow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}>
        <LinearGradient colors={[glowColor, 'transparent']} style={styles.glowGrad} />
      </Animated.View>

      <Animated.View
        style={[
          styles.ring,
          { transform: [{ scale: ring1Scale }], opacity: ring1Opacity, borderColor: glowColor },
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          { transform: [{ scale: ring2Scale }], opacity: ring2Opacity, borderColor: glowColor },
        ]}
      />

      <Animated.View style={{ transform: [{ scale: faceScale }, { translateY: faceLift }] }}>
        <Pressable onPress={handlePress} disabled={disabled}>
          <LinearGradient colors={bodyColors} style={[styles.face, { shadowColor: glowColor }]}>
            <LinearGradient
              colors={[FACE_SHEEN, 'transparent']}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.7, y: 0.55 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.innerBorder} />

            <View style={[styles.eyeShell, { left: FACE_W / 2 - EYE_SEP / 2 - EYE_W / 2, top: EYES_TOP }]}>
              <View style={styles.eyeWhite}>
                <Animated.View
                  style={[
                    styles.gazeGroup,
                    { transform: [{ translateX: pupilRenderX }, { translateY: pupilRenderY }] },
                  ]}
                >
                  <View style={styles.iris} />
                  <Animated.View
                    style={[
                      styles.pupil,
                      { transform: [{ scaleX: pupilScale }, { scaleY: pupilScale }] },
                    ]}
                  >
                    <View style={styles.pupilHighlight} />
                  </Animated.View>
                </Animated.View>
              </View>
              <Animated.View
                style={[
                  styles.lid,
                  { backgroundColor: lidColor, transform: [{ translateY: leftLidY }] },
                ]}
              />
            </View>

            <View style={[styles.eyeShell, { left: FACE_W / 2 + EYE_SEP / 2 - EYE_W / 2, top: EYES_TOP }]}>
              <View style={styles.eyeWhite}>
                <Animated.View
                  style={[
                    styles.gazeGroup,
                    { transform: [{ translateX: pupilRenderX }, { translateY: pupilRenderY }] },
                  ]}
                >
                  <View style={styles.iris} />
                  <Animated.View
                    style={[
                      styles.pupil,
                      { transform: [{ scaleX: pupilScale }, { scaleY: pupilScale }] },
                    ]}
                  >
                    <View style={styles.pupilHighlight} />
                  </Animated.View>
                </Animated.View>
              </View>
              <Animated.View
                style={[
                  styles.lid,
                  { backgroundColor: lidColor, transform: [{ translateY: rightLidY }] },
                ]}
              />
            </View>

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
    borderRadius: FACE_W * 0.58,
    borderWidth: 1,
    borderColor: FACE_BORDER,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 26,
    elevation: 14,
    overflow: 'hidden',
  },
  innerBorder: {
    position: 'absolute',
    top: 3,
    right: 3,
    bottom: 3,
    left: 3,
    borderWidth: 1,
    borderColor: FACE_INNER_BORDER,
    borderRadius: FACE_W * 0.54,
  },
  eyeShell: {
    position: 'absolute',
    width: EYE_W,
    height: EYE_H,
    overflow: 'hidden',
    borderRadius: EYE_H / 2,
  },
  eyeWhite: {
    width: EYE_W,
    height: EYE_H,
    borderRadius: EYE_H / 2,
    backgroundColor: EYE_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#c8e8ff',
    shadowOpacity: 0.45,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  gazeGroup: {
    width: IRIS_W,
    height: IRIS_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iris: {
    position: 'absolute',
    width: IRIS_W,
    height: IRIS_H,
    borderRadius: IRIS_H / 2,
    backgroundColor: IRIS_COLOR,
  },
  pupil: {
    width: PUPIL_W,
    height: PUPIL_H,
    borderRadius: PUPIL_W / 2,
    backgroundColor: PUPIL_COLOR,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  pupilHighlight: {
    width: HIGHLIGHT_SIZE,
    height: HIGHLIGHT_SIZE,
    borderRadius: HIGHLIGHT_SIZE / 2,
    backgroundColor: PUPIL_HIGHLIGHT,
    marginTop: 2,
    marginRight: 1,
  },
  lid: {
    position: 'absolute',
    left: -2,
    right: -2,
    height: LID_H,
    borderBottomLeftRadius: EYE_H,
    borderBottomRightRadius: EYE_H,
  },
  mouth: {
    position: 'absolute',
    width: MOUTH_BASE_W,
    height: MOUTH_H,
    borderRadius: MOUTH_H / 2,
    backgroundColor: MOUTH_COLOR,
  },
});
