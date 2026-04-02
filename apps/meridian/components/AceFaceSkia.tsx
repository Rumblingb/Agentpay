/**
 * AceFaceSkia — GPU-rendered Ace presence for the conversation screen.
 *
 * Rendering:  @shopify/react-native-skia 1.x Canvas (GPU thread, Metal on iOS)
 * Animation:  react-native-reanimated 3 SharedValues (UI thread)
 * Audio:      micAmplitude + ttsAmplitude SharedValues drive corona in real-time
 *
 * Layer order (bottom → top):
 *   1. Atmospheric halo        — phase-colored radial, slow breath
 *   2. Listening pulse rings   — expand outward on listening
 *   3. Dark glass oval base    — opaque dark ground for the sculpture
 *   4. 3D sculpted bust PNG    — dominant opacity, clipped to oval
 *   5. Focus field             — subtle cognition around crown/temples
 *   6. Key light               — top-left white radial, tilt-reactive
 *   7. Rim light               — bottom-right, phase-tinted
 *   8. Inner shadow            — bottom depth
 *   9. Lower-face tension      — reacts to speech/focus
 *  10. Mouth cavity + lip line — GPU-computed from real TTS energy
 *  11. Ghost oval rim          — ultra-thin separation
 *  12. Audio-reactive corona   — ring responding to real mic/TTS amplitude
 *
 * Type note: @shopify/react-native-skia 1.x ships types that conflict with
 * @types/react v19 (bigint not assignable to ReactNode). We use the same
 * require() + ComponentType cast pattern used for react-native-svg in this repo.
 */

import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _skia = require('@shopify/react-native-skia') as Record<string, unknown>;

const Canvas         = _skia['Canvas']         as React.ComponentType<any>;
const SkiaGroup      = _skia['Group']          as React.ComponentType<any>;
const SkiaCircle     = _skia['Circle']         as React.ComponentType<any>;
const SkiaImage      = _skia['Image']          as React.ComponentType<any>;
const SkiaPath       = _skia['Path']           as React.ComponentType<any>;
const RadialGradient = _skia['RadialGradient'] as React.ComponentType<any>;

// Skia namespace (non-JSX, safe to import directly)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Skia, vec, useImage } = require('@shopify/react-native-skia') as {
  Skia: { Path: { Make: () => any; MakeFromSVGString: (s: string) => any | null } };
  vec: (x: number, y: number) => any;
  useImage: (source: any) => any;
};

import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { AppPhase } from '../lib/store';
import { useAceMotion } from '../lib/aceMotion';
import type { AceBrainMode } from './AceBrain';

interface Props {
  phase: AppPhase;
  isSpeaking: boolean;
  mode?: AceBrainMode;
  /** Normalised mic amplitude 0–1, updated at ~120 ms intervals while recording. */
  micAmplitude?: SharedValue<number>;
  /** Normalised TTS amplitude 0–1, from real audio sample frames. */
  ttsAmplitude?: SharedValue<number>;
  onPress?: () => void;
  disabled?: boolean;
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

const CW = 270;
const CH = 310;
const CX = CW / 2;   // 135
const CY = CH / 2;   // 155

const GLOW_R  = 144;
const RING_R  = 122;  // Starts clearly outside the face oval edge — no mic-button shape
const MOUTH_Y = 234;  // Anatomically correct lower-lip (was 193 = nose bridge)
const MOUTH_HW = 20;

// Egg-shaped oval
const FACE_PATH_SVG =
  'M 135 38 C 178 42 209 86 206 150 C 203 212 178 259 135 276 C 92 259 67 212 64 150 C 61 86 92 42 135 38 Z';

// ─── Per-phase config ──────────────────────────────────────────────────────────

function baseMouthCurve(phase: AppPhase): number {
  if (phase === 'done') return 4.2;
  if (phase === 'listening') return 1.1;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return -0.6;
  if (phase === 'error') return -1.6;
  return 0.8;
}

function baseMouthOpacity(phase: AppPhase): number {
  if (phase === 'done') return 0.68;
  if (phase === 'error') return 0.4;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.18;
  if (phase === 'listening') return 0.14;
  return 0.12;
}

function baseTextureOpacity(phase: AppPhase): number {
  if (phase === 'listening') return 0.86;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.88;
  if (phase === 'confirming') return 0.78;
  if (phase === 'done') return 0.82;
  if (phase === 'error') return 0.66;
  return 0.78;
}

function baseFocusOpacity(phase: AppPhase): number {
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.18;
  if (phase === 'confirming') return 0.1;
  if (phase === 'listening') return 0.05;
  if (phase === 'done') return 0.04;
  if (phase === 'error') return 0.08;
  return 0.025;
}

function baseFocusScale(phase: AppPhase): number {
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 1.03;
  if (phase === 'confirming') return 1.01;
  return 1;
}

function baseFocusLift(phase: AppPhase): number {
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return -1.5;
  if (phase === 'listening' || phase === 'confirming') return -0.5;
  return 0;
}

const GLOW_COLOR: Record<AppPhase, string> = {
  idle:       '#eef4ff',
  listening:  '#ffffff',
  thinking:   '#f3f7ff',
  confirming: '#fff2dc',
  hiring:     '#f3f7ff',
  executing:  '#f2f7ff',
  done:       '#effff5',
  error:      '#ffe8ef',
};

const ACCENT_COLOR: Record<AppPhase, string> = {
  idle:       '#dbe6f6',
  listening:  '#f8fbff',
  thinking:   '#e8f0fd',
  confirming: '#f7ead0',
  hiring:     '#e8f0fd',
  executing:  '#edf3ff',
  done:       '#e6f6ea',
  error:      '#f7dde4',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AceFaceSkia({
  phase,
  isSpeaking,
  mode = 'conversation',
  micAmplitude,
  ttsAmplitude,
  onPress,
  disabled,
}: Props) {
  const bustImage = useImage(require('../assets/ace-face-render.png'));
  const markImage = useImage(require('../assets/ace-mark.png'));
  const facePath  = useMemo(() => Skia.Path.MakeFromSVGString(FACE_PATH_SVG), []);
  const { tiltX, tiltY } = useAceMotion(!disabled);
  const motionFactor = mode === 'onboarding' ? 0.45 : 1;
  const energyFactor = mode === 'onboarding' ? 0.78 : 1;

  // ─── Animation state ──────────────────────────────────────────────────────

  const glowOpacity  = useSharedValue(0.22);
  const glowScale    = useSharedValue(1);
  const faceScale    = useSharedValue(1);
  const faceLift     = useSharedValue(0);
  const ring1Scale   = useSharedValue(1);
  const ring1Opacity = useSharedValue(0);
  const ring2Scale   = useSharedValue(1);
  const ring2Opacity = useSharedValue(0);
  const textureOp    = useSharedValue(baseTextureOpacity('idle'));
  const focusOpacity = useSharedValue(baseFocusOpacity('idle'));
  const focusScale   = useSharedValue(baseFocusScale('idle'));
  const focusLift    = useSharedValue(baseFocusLift('idle'));
  const mouthCurve   = useSharedValue(baseMouthCurve('idle'));
  const mouthOp      = useSharedValue(0);
  const coronaActive = useSharedValue(0); // 0–1, drives corona visibility

  const glowColor   = GLOW_COLOR[phase]   ?? '#eef4ff';
  const accentColor = ACCENT_COLOR[phase] ?? '#dbe6f6';

  // ─── Derived transforms (UI thread) ──────────────────────────────────────

  const glowTransform = useDerivedValue(() => [
    { translateX: CX + tiltX.value * 6 * motionFactor }, { translateY: CY - tiltY.value * 6 * motionFactor },
    { scale: glowScale.value },
    { translateX: -CX }, { translateY: -CY },
  ]);

  const faceTransform = useDerivedValue(() => [
    { translateX: CX + tiltX.value * 7 * motionFactor }, { translateY: CY + faceLift.value - tiltY.value * 7 * motionFactor },
    { scale: faceScale.value },
    { translateX: -CX }, { translateY: -CY },
  ]);

  const ring1Transform = useDerivedValue(() => [
    { translateX: CX + tiltX.value * 4 * motionFactor }, { translateY: CY - tiltY.value * 4 * motionFactor },
    { scale: ring1Scale.value },
    { translateX: -CX }, { translateY: -CY },
  ]);

  const ring2Transform = useDerivedValue(() => [
    { translateX: CX + tiltX.value * 4 * motionFactor }, { translateY: CY - tiltY.value * 4 * motionFactor },
    { scale: ring2Scale.value },
    { translateX: -CX }, { translateY: -CY },
  ]);

  const bustTransform = useDerivedValue(() => [
    { translateX: tiltX.value * 10 * motionFactor },
    { translateY: -tiltY.value * 8 * motionFactor + focusLift.value * 0.2 },
  ]);

  const keyLightTransform = useDerivedValue(() => [
    { translateX: -tiltX.value * 12 * motionFactor },
    { translateY: -tiltY.value * 10 * motionFactor - focusLift.value * 0.3 },
  ]);

  const rimLightTransform = useDerivedValue(() => [
    { translateX: tiltX.value * 14 * motionFactor },
    { translateY: tiltY.value * 12 * motionFactor + focusLift.value * 0.3 },
  ]);

  const focusTransform = useDerivedValue(() => {
    const anchorY = CY - 52;
    return [
      { translateX: CX + tiltX.value * 5 * motionFactor },
      { translateY: anchorY + focusLift.value - tiltY.value * 5 * motionFactor },
      { scale: focusScale.value },
      { translateX: -CX },
      { translateY: -anchorY },
    ];
  });

  const lowerFaceTransform = useDerivedValue(() => {
    const anchorY = CY + 58;
    return [
      { translateX: CX + tiltX.value * 3 * motionFactor },
      { translateY: anchorY - tiltY.value * 2 * motionFactor },
      { scale: 1 + focusOpacity.value * 0.1 },
      { translateX: -CX },
      { translateY: -anchorY },
    ];
  });

  // ─── Audio-reactive corona (UI thread, every frame) ───────────────────────

  const speechEnergy = useDerivedValue(() => {
    const level = ttsAmplitude?.value ?? 0;
    const floor = isSpeaking ? 0.12 : 0;
    return Math.max(floor, Math.min(1, level));
  });

  const coronaRadius = useDerivedValue(() => {
    const mic = micAmplitude?.value ?? 0;
    const tts = ttsAmplitude?.value ?? 0;
    const phaseBoost = phase === 'thinking' || phase === 'hiring' || phase === 'executing' ? 4 : 0;
    return 108 + Math.max(mic, tts) * 18 + phaseBoost;
  });

  const coronaOpacity = useDerivedValue(() => {
    const mic = micAmplitude?.value ?? 0;
    const tts = ttsAmplitude?.value ?? 0;
    return coronaActive.value * (0.08 + Math.max(mic, tts) * 0.54);
  });

  const coronaVisualOpacity = useDerivedValue(() => coronaOpacity.value * energyFactor);

  // ─── GPU-computed mouth path (UI thread) ─────────────────────────────────

  const mouthFillPath = useDerivedValue(() => {
    const energy = speechEnergy.value * energyFactor;
    const widthBoost = 1 + energy * 0.16;
    const open = mouthOp.value * (energy * 9.5 + (isSpeaking ? 2.3 : 0.5));
    const x0 = CX - MOUTH_HW * widthBoost;
    const x3 = CX + MOUTH_HW * widthBoost;
    const y = MOUTH_Y;
    const topY = y - mouthCurve.value * 0.62 - open * 0.12;
    const bottomY = y + open;
    const path = Skia.Path.Make();
    path.moveTo(x0, y);
    path.cubicTo(
      x0 + MOUTH_HW * 0.56 * widthBoost, topY,
      x3 - MOUTH_HW * 0.56 * widthBoost, topY,
      x3, y,
    );
    path.cubicTo(
      x3 - MOUTH_HW * 0.52 * widthBoost, bottomY,
      x0 + MOUTH_HW * 0.52 * widthBoost, bottomY,
      x0, y,
    );
    path.close();
    return path;
  });

  const mouthLinePath = useDerivedValue(() => {
    const energy = speechEnergy.value * energyFactor;
    const path = Skia.Path.Make();
    const x0 = CX - MOUTH_HW * (1 + energy * 0.12);
    const x3 = CX + MOUTH_HW * (1 + energy * 0.12);
    const y = MOUTH_Y;
    const cp = y - mouthCurve.value - energy * 0.45;
    path.moveTo(x0, y);
    path.cubicTo(
      x0 + MOUTH_HW * 0.52, cp,
      x3 - MOUTH_HW * 0.52, cp,
      x3, y,
    );
    return path;
  });

  const focusVisualOpacity = useDerivedValue(() =>
    focusOpacity.value * (isSpeaking ? 0.28 : 1),
  );

  const lowerFaceShadowOpacity = useDerivedValue(() => {
    const processingBoost =
      phase === 'thinking' || phase === 'hiring' || phase === 'executing'
        ? 0.1
        : phase === 'confirming'
          ? 0.05
          : 0;
    return 0.07 + focusOpacity.value * 0.18 + speechEnergy.value * energyFactor * 0.16 + processingBoost;
  });

  // ─── Phase animation ──────────────────────────────────────────────────────

  useEffect(() => {
    [
      faceScale, faceLift, glowOpacity, glowScale,
      ring1Scale, ring1Opacity, ring2Scale, ring2Opacity,
      textureOp, focusOpacity, focusScale, focusLift, mouthCurve, mouthOp, coronaActive,
    ].forEach(cancelAnimation);

    const t = (val: number, ms: number, easing = Easing.inOut(Easing.sin)) =>
      withTiming(val, { duration: ms, easing });

    const ringExpand = mode === 'onboarding' ? 1.56 : 1.72;
    const secondaryRingOpacity = mode === 'onboarding' ? 0.1 : 0.14;

    faceScale.value    = t(1, 220);
    faceLift.value     = t(0, 220);
    glowScale.value    = t(1, 220);
    glowOpacity.value  = t(0.22, 220);
    ring1Scale.value   = 1;
    ring1Opacity.value = 0;
    ring2Scale.value   = 1;
    ring2Opacity.value = 0;
    textureOp.value    = t(baseTextureOpacity(phase), 240);
    focusOpacity.value = t(baseFocusOpacity(phase), 220);
    focusScale.value   = t(baseFocusScale(phase), 220);
    focusLift.value    = t(baseFocusLift(phase), 220);
    mouthCurve.value   = t(baseMouthCurve(phase), 220);
    mouthOp.value      = t(baseMouthOpacity(phase), 220);
    coronaActive.value = t(phase === 'listening' ? 1 : 0, 200);

    if (phase === 'idle') {
      glowOpacity.value = withRepeat(withSequence(t(0.32, 2600), t(0.14, 2600)), -1, false);
      glowScale.value   = withRepeat(withSequence(t(1.07, 2600), t(1, 2600)), -1, false);
      faceLift.value    = withRepeat(withSequence(t(-3, 2400), t(0, 2400)), -1, false);
      textureOp.value   = withRepeat(withSequence(t(0.84, 2400), t(0.72, 2400)), -1, false);
      focusOpacity.value = withRepeat(withSequence(t(0.04, 2400), t(0.02, 2400)), -1, false);
    }

    if (phase === 'listening') {
      glowOpacity.value  = t(0.52, 280);
      faceScale.value    = withRepeat(withSequence(t(1.022, 1050), t(1, 1050)), -1, false);
      textureOp.value    = withRepeat(withSequence(t(0.90, 900), t(0.80, 900)), -1, false);
      focusOpacity.value = withRepeat(withSequence(t(0.08, 1200), t(0.04, 1200)), -1, false);
      focusScale.value   = withRepeat(withSequence(t(1.01, 1200), t(1, 1200)), -1, false);
      ring1Opacity.value = withRepeat(withSequence(
        t(0.22, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false);
      ring1Scale.value = withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(ringExpand, 1800, Easing.out(Easing.quad)),
      ), -1, false);
      ring2Opacity.value = withDelay(900, withRepeat(withSequence(
        t(secondaryRingOpacity, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false));
      ring2Scale.value = withDelay(900, withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(ringExpand, 1800, Easing.out(Easing.quad)),
      ), -1, false));
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      glowOpacity.value = withRepeat(withSequence(t(0.48, 900), t(0.24, 900)), -1, false);
      glowScale.value   = withRepeat(withSequence(t(1.09, 900), t(1, 900)), -1, false);
      faceLift.value    = withRepeat(withSequence(t(-2, 900), t(0, 900)), -1, false);
      textureOp.value   = withRepeat(withSequence(t(0.92, 760), t(0.82, 760)), -1, false);
      focusOpacity.value = withRepeat(withSequence(t(0.18, 820), t(0.1, 820)), -1, false);
      focusScale.value   = withRepeat(withSequence(t(1.04, 820), t(1.01, 820)), -1, false);
      focusLift.value    = withRepeat(withSequence(t(-3, 820), t(-1, 820)), -1, false);
    }

    if (phase === 'confirming') {
      glowOpacity.value = t(0.38, 320);
      textureOp.value   = t(0.78, 320);
      focusOpacity.value = t(0.1, 320);
      focusScale.value   = t(1.01, 320);
      focusLift.value    = t(-0.5, 320);
    }

    if (phase === 'done') {
      faceScale.value   = withSpring(1.04, { damping: 14, stiffness: 180 });
      faceLift.value    = withSpring(-4,   { damping: 12, stiffness: 150 });
      glowOpacity.value = t(0.44, 320);
      textureOp.value   = t(0.82, 320);
      focusOpacity.value = t(0.04, 320);
      focusScale.value   = t(1, 320);
      focusLift.value    = t(-1, 320);
    }

    if (phase === 'error') {
      glowOpacity.value = t(0.28, 260);
      textureOp.value   = t(0.66, 260);
      focusOpacity.value = t(0.08, 260);
      focusScale.value   = t(1.01, 260);
    }
  }, [
    phase,
    faceScale, faceLift, glowOpacity, glowScale,
    ring1Scale, ring1Opacity, ring2Scale, ring2Opacity,
    textureOp, focusOpacity, focusScale, focusLift, mouthCurve, mouthOp, coronaActive,
  ]);

  // ─── Speaking animation ───────────────────────────────────────────────────

  useEffect(() => {
    [mouthCurve, mouthOp, coronaActive].forEach(cancelAnimation);

    const t = (val: number, ms: number) =>
      withTiming(val, { duration: ms, easing: Easing.inOut(Easing.sin) });

    if (isSpeaking) {
      mouthCurve.value   = withRepeat(withSequence(
        t(3.1, 150), t(0.9, 160), t(2.6, 140), t(0.4, 165),
      ), -1, false);
      mouthOp.value      = t(0.92, 120);
      coronaActive.value = t(1, 180);
    } else {
      mouthCurve.value   = t(baseMouthCurve(phase), 220);
      mouthOp.value      = t(baseMouthOpacity(phase), 200);
      coronaActive.value = t(phase === 'listening' ? 1 : 0, 240);
    }

    return () => {
      [mouthCurve, mouthOp, coronaActive].forEach(cancelAnimation);
    };
  }, [isSpeaking, phase, mouthCurve, mouthOp, coronaActive]);

  // ─── Interaction ──────────────────────────────────────────────────────────

  const isInteractive = phase !== 'done';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || !isInteractive}
      style={styles.container}
    >
      <Canvas style={styles.canvas}>

        {/* ① Atmospheric halo */}
        <SkiaGroup opacity={glowOpacity} transform={glowTransform}>
          <SkiaCircle cx={CX} cy={CY} r={GLOW_R}>
            <RadialGradient
              c={vec(CX, CY)} r={GLOW_R}
              colors={[glowColor, 'transparent']}
            />
          </SkiaCircle>
        </SkiaGroup>

        {/* ② Listening pulse rings — start outside the face oval */}
        <SkiaGroup opacity={ring1Opacity} transform={ring1Transform}>
          <SkiaCircle
            cx={CX} cy={CY} r={RING_R}
            style="stroke" strokeWidth={1.15}
            color={accentColor}
          />
        </SkiaGroup>
        <SkiaGroup opacity={ring2Opacity} transform={ring2Transform}>
          <SkiaCircle
            cx={CX} cy={CY} r={RING_R}
            style="stroke" strokeWidth={0.9}
            color={accentColor}
          />
        </SkiaGroup>

        {/* ③–⑨ Face group — lifts and scales as a unit */}
        <SkiaGroup transform={faceTransform}>

          {/* ③ Dark glass oval base — sculpture reads against dark ground */}
          <SkiaPath path={facePath} color="rgba(8,16,28,0.92)" />

          {/* ④ 3D sculptural bust (dominant) */}
          <SkiaGroup opacity={textureOp} clip={facePath}>
            {bustImage !== null && (
              <SkiaGroup transform={bustTransform}>
                <SkiaImage
                  image={bustImage}
                  x={-6} y={4}
                  width={282} height={298}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {bustImage === null && markImage !== null && (
              <SkiaImage
                image={markImage}
                x={83}
                y={82}
                width={104}
                height={136}
                fit="contain"
                opacity={0.92}
              />
            )}
            {bustImage === null && (
              <SkiaCircle cx={CX} cy={CY - 4} r={58}>
                <RadialGradient
                  c={vec(CX, CY - 4)} r={58}
                  colors={['rgba(231,241,255,0.28)', 'transparent']}
                />
              </SkiaCircle>
            )}
          </SkiaGroup>

          {/* ⑤ Processing field — subtle cognition around crown and temples */}
          <SkiaGroup clip={facePath} opacity={focusVisualOpacity} transform={focusTransform}>
            <SkiaCircle cx={90} cy={108} r={44}>
              <RadialGradient
                c={vec(90, 108)} r={44}
                colors={[accentColor, 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={180} cy={108} r={44}>
              <RadialGradient
                c={vec(180, 108)} r={44}
                colors={[accentColor, 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={135} cy={84} r={62}>
              <RadialGradient
                c={vec(135, 84)} r={62}
                colors={['rgba(242,247,255,0.42)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑤ Key light — top-left directional */}
          <SkiaGroup clip={facePath} transform={keyLightTransform}>
            <SkiaCircle cx={82} cy={76} r={156}>
              <RadialGradient
                c={vec(82, 76)} r={156}
                colors={['rgba(255,255,255,0.26)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑥ Rim light — bottom-right, phase-tinted */}
          <SkiaGroup clip={facePath} transform={rimLightTransform}>
            <SkiaCircle cx={200} cy={250} r={128}>
              <RadialGradient
                c={vec(200, 250)} r={128}
                colors={[glowColor, 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑦ Inner shadow — bottom depth */}
          <SkiaGroup clip={facePath}>
            <SkiaCircle cx={142} cy={235} r={158}>
              <RadialGradient
                c={vec(142, 235)} r={158}
                colors={['rgba(18,24,36,0.32)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑧ Lower-face tension — reacts to speech energy and focus */}
          <SkiaGroup clip={facePath} opacity={lowerFaceShadowOpacity} transform={lowerFaceTransform}>
            <SkiaCircle cx={135} cy={238} r={64}>
              <RadialGradient
                c={vec(135, 238)} r={64}
                colors={['rgba(18,24,36,0.42)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑨ Mouth — speech-driven cavity + lip line */}
          <SkiaPath
            path={mouthFillPath}
            color="rgba(34,42,58,0.72)"
            opacity={mouthOp}
          />
          <SkiaPath
            path={mouthLinePath}
            style="stroke"
            strokeWidth={2.4}
            strokeCap="round"
            color="rgba(230,244,255,0.98)"
            opacity={mouthOp}
          />

          {/* ⑩ Ghost oval rim — minimal separation from background */}
          <SkiaPath
            path={facePath}
            style="stroke"
            strokeWidth={1}
            color="rgba(200,225,255,0.07)"
          />

        </SkiaGroup>

        {/* ⑪ Audio-reactive corona — reacts every frame to real amplitude */}
        <SkiaCircle
          cx={CX} cy={CY}
          r={coronaRadius}
          style="stroke"
          strokeWidth={1.6}
          color={accentColor}
          opacity={coronaVisualOpacity}
        />

      </Canvas>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CW,
    height: CH,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  canvas: {
    width: CW,
    height: CH,
  },
});
