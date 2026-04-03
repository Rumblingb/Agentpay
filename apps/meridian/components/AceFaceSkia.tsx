/**
 * AceFaceSkia — GPU-rendered Ace presence for the conversation screen.
 *
 * Rendering:  @shopify/react-native-skia 1.x Canvas (GPU thread, Metal on iOS)
 * Animation:  react-native-reanimated 3 SharedValues (UI thread)
 * Audio:      micAmplitude + ttsAmplitude SharedValues drive corona in real-time
 *
 * Layer order (bottom -> top):
 *   1. Atmospheric halo        - phase-colored radial, slow breath
 *   2. Listening pulse rings   - expand outward on listening
 *   3. 3D sculpted bust PNG    - dominant opacity with alpha silhouette
 *   4. Focus field             - subtle cognition around crown/temples
 *   5. Key light               - top-left white radial, tilt-reactive
 *   6. Rim light               - bottom-right, phase-tinted
 *   7. Inner shadow            - bottom depth
 *   8. Lower-face tension      - reacts to speech/focus
 *   9. Mouth cavity + lip line - GPU-computed from real TTS energy
 *  10. Ghost oval rim          - ultra-thin fallback separation
 *  11. Audio-reactive corona   - ring responding to real mic/TTS amplitude
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
import { ACE_BRAIN_RENDER_PACK } from '../lib/aceBrainRenderPack';
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
const MOUTH_Y = 204;  // Align synthetic support path to Ace's actual rendered mouth
const MOUTH_HW = 20;
const BUST_X = -6;
const BUST_Y = 4;
const BUST_W = 282;
const BUST_H = 298;

// Egg-shaped oval
const FACE_PATH_SVG =
  'M 135 38 C 178 42 209 86 206 150 C 203 212 178 259 135 276 C 92 259 67 212 64 150 C 61 86 92 42 135 38 Z';

// ─── Per-phase config ──────────────────────────────────────────────────────────

function baseMouthCurve(phase: AppPhase): number {
  'worklet';
  if (phase === 'done') return 4.2;
  if (phase === 'listening') return 1.1;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return -0.6;
  if (phase === 'error') return -1.6;
  return 0.8;
}

function baseMouthOpacity(phase: AppPhase): number {
  'worklet';
  if (phase === 'done') return 0.68;
  if (phase === 'error') return 0.4;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.18;
  if (phase === 'listening') return 0.14;
  return 0.12;
}

function baseTextureOpacity(phase: AppPhase): number {
  'worklet';
  if (phase === 'listening') return 0.86;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.88;
  if (phase === 'confirming') return 0.78;
  if (phase === 'done') return 0.82;
  if (phase === 'error') return 0.66;
  return 0.78;
}

function baseFocusOpacity(phase: AppPhase): number {
  'worklet';
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.18;
  if (phase === 'confirming') return 0.1;
  if (phase === 'listening') return 0.05;
  if (phase === 'done') return 0.04;
  if (phase === 'error') return 0.08;
  return 0.025;
}

function baseFocusScale(phase: AppPhase): number {
  'worklet';
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 1.03;
  if (phase === 'confirming') return 1.01;
  return 1;
}

function baseFocusLift(phase: AppPhase): number {
  'worklet';
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return -1.5;
  if (phase === 'listening' || phase === 'confirming') return -0.5;
  return 0;
}

function baseGazeVoidOpacity(phase: AppPhase): number {
  'worklet';
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.34;
  if (phase === 'listening') return 0.3;
  if (phase === 'confirming') return 0.26;
  if (phase === 'done') return 0.24;
  if (phase === 'error') return 0.28;
  return 0.22;
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
  const bustImage = useImage(ACE_BRAIN_RENDER_PACK.beauty);
  const alphaImage = useImage(ACE_BRAIN_RENDER_PACK.alpha);
  const depthImage = useImage(ACE_BRAIN_RENDER_PACK.depth);
  const mouthMaskImage = useImage(ACE_BRAIN_RENDER_PACK.mouthMask);
  const focusMaskImage = useImage(ACE_BRAIN_RENDER_PACK.focusMask);
  const markImage = useImage(ACE_BRAIN_RENDER_PACK.sigilFallback);
  const specularImage = useImage(ACE_BRAIN_RENDER_PACK.specular);
  const speechJawImage = useImage(ACE_BRAIN_RENDER_PACK.speechJaw);
  const speechOoImage = useImage(ACE_BRAIN_RENDER_PACK.speechOo);
  const speechEeImage = useImage(ACE_BRAIN_RENDER_PACK.speechEe);
  const focusExpressionImage = useImage(ACE_BRAIN_RENDER_PACK.expressionFocus);
  const smileExpressionImage = useImage(ACE_BRAIN_RENDER_PACK.expressionSmile);
  const facePath  = useMemo(() => Skia.Path.MakeFromSVGString(FACE_PATH_SVG), []);
  const { tiltX, tiltY } = useAceMotion(!disabled);
  const motionFactor = mode === 'onboarding' ? 0.45 : 1;
  const energyFactor = mode === 'onboarding' ? 0.78 : 1;
  const hasDeformationPack =
    alphaImage !== null &&
    depthImage !== null &&
    mouthMaskImage !== null &&
    focusMaskImage !== null &&
    specularImage !== null;
  const hasSpeechRenderPack =
    speechJawImage !== null &&
    speechOoImage !== null &&
    speechEeImage !== null;
  const hasExpressionRenderPack =
    focusExpressionImage !== null &&
    smileExpressionImage !== null;

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

  const gazeVoidTransform = useDerivedValue(() => {
    const anchorY = CY - 44;
    return [
      { translateX: CX + tiltX.value * 4 * motionFactor },
      { translateY: anchorY - tiltY.value * 4 * motionFactor + focusLift.value * 0.18 },
      { scale: 1 + focusOpacity.value * 0.06 },
      { translateX: -CX },
      { translateY: -anchorY },
    ];
  });

  const deformationDepthTransform = useDerivedValue(() => [
    { translateX: tiltX.value * 4 * motionFactor },
    { translateY: -tiltY.value * 5 * motionFactor + focusLift.value * 0.18 },
  ]);

  const deformationSpecularTransform = useDerivedValue(() => [
    { translateX: -tiltX.value * 11 * motionFactor },
    { translateY: -tiltY.value * 9 * motionFactor - focusLift.value * 0.24 },
  ]);


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
    const level = Math.max(0, Math.min(1, ttsAmplitude?.value ?? 0));
    const floor = isSpeaking ? 0.08 : 0;
    return Math.min(1, Math.pow(Math.max(level, floor), 0.82));
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

  const gazeVoidOpacity = useDerivedValue(() => {
    const phaseBase = baseGazeVoidOpacity(phase);
    return Math.min(0.58, phaseBase + speechEnergy.value * 0.08 + focusOpacity.value * 0.16);
  });

  const eyeMystiqueOpacity = useDerivedValue(() => {
    const phaseBoost =
      phase === 'thinking' || phase === 'hiring' || phase === 'executing'
        ? 0.06
        : phase === 'listening'
          ? 0.04
          : 0.02;
    return Math.min(0.18, 0.02 + phaseBoost + focusOpacity.value * 0.12 + speechEnergy.value * energyFactor * 0.03);
  });

  const liveMouthCurve = useDerivedValue(() => {
    if (!isSpeaking) return mouthCurve.value;
    const energy = speechEnergy.value * energyFactor;
    return 0.9 + energy * 6.4;
  });

  const liveMouthOpacity = useDerivedValue(() => {
    if (!isSpeaking) return mouthOp.value;
    const energy = speechEnergy.value * energyFactor;
    return Math.min(0.96, 0.58 + energy * 0.34);
  });

  const deformationMouthTransform = useDerivedValue(() => {
    const anchorY = MOUTH_Y;
    const energy = speechEnergy.value * energyFactor;
    const scaleX = 1 + energy * 0.05;
    const scaleY = 1 + energy * 0.12;
    return [
      { translateX: CX + tiltX.value * 2 * motionFactor },
      { translateY: anchorY + energy * 0.8 },
      { scaleX },
      { scaleY },
      { translateX: -CX },
      { translateY: -anchorY },
    ];
  });

  const alphaAuraOpacity = useDerivedValue(() =>
    hasDeformationPack ? (0.08 + glowOpacity.value * 0.1 + focusOpacity.value * 0.08) : 0,
  );

  const depthVisualOpacity = useDerivedValue(() =>
    hasDeformationPack ? (0.12 + focusOpacity.value * 0.24 + speechEnergy.value * energyFactor * 0.06) : 0,
  );

  const focusMaskOpacity = useDerivedValue(() => {
    if (!hasDeformationPack) return 0;
    const processingBoost =
      phase === 'thinking' || phase === 'hiring' || phase === 'executing'
        ? 0.16
        : phase === 'listening'
          ? 0.08
          : 0.04;
    return Math.min(0.46, focusOpacity.value * 0.9 + processingBoost);
  });

  const mouthMaskOpacity = useDerivedValue(() =>
    hasDeformationPack ? liveMouthOpacity.value * (0.18 + speechEnergy.value * energyFactor * 0.28) : 0,
  );

  const specularVisualOpacity = useDerivedValue(() => {
    if (!hasDeformationPack) return 0;
    const phaseBoost =
      phase === 'thinking' || phase === 'hiring' || phase === 'executing'
        ? 0.12
        : phase === 'listening'
          ? 0.08
          : 0.04;
    return Math.min(0.34, 0.06 + phaseBoost + speechEnergy.value * energyFactor * 0.08);
  });

  const crownSheenOpacity = useDerivedValue(() => {
    const phaseBoost =
      phase === 'thinking' || phase === 'hiring' || phase === 'executing'
        ? 0.06
        : phase === 'listening'
          ? 0.03
          : 0.015;
    return Math.min(0.22, 0.03 + glowOpacity.value * 0.12 + focusOpacity.value * 0.1 + phaseBoost);
  });

  const sculpturalVignetteOpacity = useDerivedValue(() => {
    const phaseBoost = phase === 'thinking' || phase === 'hiring' || phase === 'executing' ? 0.03 : 0.01;
    return Math.min(0.1, 0.02 + phaseBoost + focusOpacity.value * 0.05);
  });

  const silhouetteRimOpacity = useDerivedValue(() =>
    Math.min(0.08, 0.015 + focusOpacity.value * 0.06 + speechEnergy.value * energyFactor * 0.03),
  );

  const speechJawOpacity = useDerivedValue(() => {
    if (!hasSpeechRenderPack || !isSpeaking) return 0;
    return Math.min(0.78, 0.14 + speechEnergy.value * energyFactor * 0.52);
  });

  const speechOoOpacity = useDerivedValue(() => {
    if (!hasSpeechRenderPack || !isSpeaking) return 0;
    const roundedBias = Math.max(0, 0.42 - speechEnergy.value);
    return Math.min(0.3, liveMouthOpacity.value * (0.06 + roundedBias * 0.42));
  });

  const speechEeOpacity = useDerivedValue(() => {
    if (!hasSpeechRenderPack || !isSpeaking) return 0;
    const wideBias = Math.max(0, speechEnergy.value - 0.18);
    return Math.min(0.24, liveMouthOpacity.value * (0.04 + wideBias * 0.28));
  });

  const focusExpressionOpacity = useDerivedValue(() => {
    if (!hasExpressionRenderPack) return 0;
    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      return Math.min(0.34, 0.1 + focusOpacity.value * 0.9);
    }
    if (phase === 'listening') return 0.04;
    return 0;
  });

  const smileExpressionOpacity = useDerivedValue(() => {
    if (!hasExpressionRenderPack) return 0;
    if (phase === 'done') return 0.24;
    if (phase === 'confirming') return 0.08;
    return 0;
  });

  const mouthFillVisualOpacity = useDerivedValue(() =>
    hasSpeechRenderPack && isSpeaking ? liveMouthOpacity.value * 0.12 : liveMouthOpacity.value * 0.78,
  );

  const mouthLineVisualOpacity = useDerivedValue(() =>
    hasSpeechRenderPack && isSpeaking ? liveMouthOpacity.value * 0.16 : liveMouthOpacity.value * 0.8,
  );

  // ─── GPU-computed mouth path (UI thread) ─────────────────────────────────

  const mouthFillPath = useDerivedValue(() => {
    const energy = speechEnergy.value * energyFactor;
    const widthBoost = isSpeaking ? 1 + energy * 0.22 : 1 + energy * 0.16;
    const open = liveMouthOpacity.value * (isSpeaking ? 1.4 + energy * 10.8 : energy * 9.5 + 0.5);
    const x0 = CX - MOUTH_HW * widthBoost;
    const x3 = CX + MOUTH_HW * widthBoost;
    const y = MOUTH_Y;
    const topY = y - liveMouthCurve.value * 0.68 - open * 0.1;
    const bottomY = y + open + (isSpeaking ? energy * 1.4 : energy * 0.7);
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
    const x0 = CX - MOUTH_HW * (isSpeaking ? 1 + energy * 0.18 : 1 + energy * 0.12);
    const x3 = CX + MOUTH_HW * (isSpeaking ? 1 + energy * 0.18 : 1 + energy * 0.12);
    const y = MOUTH_Y;
    const cp = y - liveMouthCurve.value - energy * (isSpeaking ? 0.9 : 0.45);
    path.moveTo(x0, y);
    path.cubicTo(
      x0 + MOUTH_HW * 0.52 * (1 + energy * 0.08), cp,
      x3 - MOUTH_HW * 0.52 * (1 + energy * 0.08), cp,
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
        ? 0.05
        : phase === 'confirming'
          ? 0.03
          : 0;
    return 0.025 + focusOpacity.value * 0.08 + speechEnergy.value * energyFactor * 0.06 + processingBoost;
  });

  // ─── Phase animation ──────────────────────────────────────────────────────

  useEffect(() => {
    [
      faceScale, faceLift, glowOpacity, glowScale,
      ring1Scale, ring1Opacity, ring2Scale, ring2Opacity,
      textureOp, focusOpacity, focusScale, focusLift, mouthCurve, mouthOp,
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
    textureOp, focusOpacity, focusScale, focusLift, mouthCurve, mouthOp,
  ]);

  // ─── Speaking animation ───────────────────────────────────────────────────

  useEffect(() => {
    [mouthCurve, mouthOp, coronaActive].forEach(cancelAnimation);

    const t = (val: number, ms: number) =>
      withTiming(val, { duration: ms, easing: Easing.inOut(Easing.sin) });

    if (isSpeaking) {
      mouthCurve.value   = t(1.4, 120);
      mouthOp.value      = t(0.78, 120);
    } else {
      mouthCurve.value   = t(baseMouthCurve(phase), 220);
      mouthOp.value      = t(baseMouthOpacity(phase), 200);
    }
    coronaActive.value = t(isSpeaking || phase === 'listening' ? 1 : 0, isSpeaking ? 180 : 220);

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

          {/* ④ 3D sculptural bust (dominant) */}
          <SkiaGroup opacity={textureOp}>
            {bustImage !== null && (
              <SkiaGroup transform={bustTransform}>
                <SkiaImage
                  image={bustImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {hasExpressionRenderPack && focusExpressionImage !== null && (
              <SkiaGroup opacity={focusExpressionOpacity} transform={bustTransform}>
                <SkiaImage
                  image={focusExpressionImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {hasExpressionRenderPack && smileExpressionImage !== null && (
              <SkiaGroup opacity={smileExpressionOpacity} transform={bustTransform}>
                <SkiaImage
                  image={smileExpressionImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {hasSpeechRenderPack && speechJawImage !== null && (
              <SkiaGroup opacity={speechJawOpacity} transform={bustTransform}>
                <SkiaImage
                  image={speechJawImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {hasSpeechRenderPack && speechOoImage !== null && (
              <SkiaGroup opacity={speechOoOpacity} transform={bustTransform}>
                <SkiaImage
                  image={speechOoImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {hasSpeechRenderPack && speechEeImage !== null && (
              <SkiaGroup opacity={speechEeOpacity} transform={bustTransform}>
                <SkiaImage
                  image={speechEeImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {hasDeformationPack && alphaImage !== null && (
              <SkiaGroup opacity={alphaAuraOpacity} transform={bustTransform}>
                <SkiaImage
                  image={alphaImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {hasDeformationPack && depthImage !== null && (
              <SkiaGroup opacity={depthVisualOpacity} transform={deformationDepthTransform}>
                <SkiaImage
                  image={depthImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
                  fit="contain"
                />
              </SkiaGroup>
            )}
            {hasDeformationPack && specularImage !== null && (
              <SkiaGroup opacity={specularVisualOpacity} transform={deformationSpecularTransform}>
                <SkiaImage
                  image={specularImage}
                  x={BUST_X} y={BUST_Y}
                  width={BUST_W} height={BUST_H}
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
          <SkiaGroup opacity={focusVisualOpacity} transform={focusTransform}>
            {hasDeformationPack && focusMaskImage !== null && (
              <SkiaImage
                image={focusMaskImage}
                x={BUST_X}
                y={BUST_Y}
                width={BUST_W}
                height={BUST_H}
                fit="contain"
                opacity={focusMaskOpacity}
              />
            )}
            <SkiaCircle cx={78} cy={104} r={38}>
              <RadialGradient
                c={vec(78, 104)} r={38}
                colors={['rgba(232,239,248,0.16)', 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={192} cy={104} r={38}>
              <RadialGradient
                c={vec(192, 104)} r={38}
                colors={['rgba(232,239,248,0.16)', 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={135} cy={80} r={58}>
              <RadialGradient
                c={vec(135, 80)} r={58}
                colors={['rgba(246,249,255,0.26)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑤ Key light — top-left directional */}
          <SkiaGroup transform={keyLightTransform}>
            <SkiaCircle cx={82} cy={76} r={156}>
              <RadialGradient
                c={vec(82, 76)} r={156}
                colors={['rgba(255,255,255,0.18)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑥ Rim light — bottom-right, phase-tinted */}
          <SkiaGroup transform={rimLightTransform}>
            <SkiaCircle cx={200} cy={250} r={128}>
              <RadialGradient
                c={vec(200, 250)} r={128}
                colors={['rgba(226,238,252,0.18)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* Sculptural crown sheen — premium top-plane read without adding clutter */}
          <SkiaGroup opacity={crownSheenOpacity} transform={keyLightTransform}>
            <SkiaCircle cx={126} cy={58} r={96}>
              <RadialGradient
                c={vec(126, 58)} r={96}
                colors={['rgba(250,252,255,0.22)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑦ Inner shadow — bottom depth */}
          {/* Oracle gaze void — the sockets stay deeper than the surrounding face */}
          <SkiaGroup opacity={gazeVoidOpacity} transform={gazeVoidTransform}>
            <SkiaCircle cx={98} cy={114} r={28}>
              <RadialGradient
                c={vec(98, 114)} r={28}
                colors={['rgba(6,10,18,0.72)', 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={172} cy={114} r={28}>
              <RadialGradient
                c={vec(172, 114)} r={28}
                colors={['rgba(6,10,18,0.72)', 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={135} cy={124} r={34}>
              <RadialGradient
                c={vec(135, 124)} r={34}
                colors={['rgba(10,14,22,0.24)', 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={98} cy={110} r={12} opacity={eyeMystiqueOpacity}>
              <RadialGradient
                c={vec(98, 110)} r={12}
                colors={['rgba(174, 212, 255, 0.5)', 'rgba(70, 112, 196, 0.12)', 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={172} cy={110} r={12} opacity={eyeMystiqueOpacity}>
              <RadialGradient
                c={vec(172, 110)} r={12}
                colors={['rgba(174, 212, 255, 0.5)', 'rgba(70, 112, 196, 0.12)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* Inner shadow — bottom depth */}
          <SkiaGroup>
            <SkiaCircle cx={142} cy={224} r={146}>
              <RadialGradient
                c={vec(142, 235)} r={158}
                colors={['rgba(20,26,38,0.16)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* Sculptural side falloff — keeps the bust expensive instead of flat */}
          <SkiaGroup opacity={sculpturalVignetteOpacity}>
            <SkiaCircle cx={58} cy={156} r={108}>
              <RadialGradient
                c={vec(58, 156)} r={108}
                colors={['rgba(12,18,28,0.18)', 'transparent']}
              />
            </SkiaCircle>
            <SkiaCircle cx={212} cy={162} r={104}>
              <RadialGradient
                c={vec(212, 162)} r={104}
                colors={['rgba(12,18,28,0.14)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑧ Lower-face tension — reacts to speech energy and focus */}
          <SkiaGroup opacity={lowerFaceShadowOpacity} transform={lowerFaceTransform}>
            <SkiaCircle cx={135} cy={222} r={56}>
              <RadialGradient
                c={vec(135, 238)} r={64}
                colors={['rgba(18,24,36,0.24)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑨ Mouth — speech-driven cavity + lip line */}
          {hasDeformationPack && mouthMaskImage !== null && (
            <SkiaGroup opacity={mouthMaskOpacity} transform={deformationMouthTransform}>
              <SkiaImage
                image={mouthMaskImage}
                x={BUST_X}
                y={BUST_Y}
                width={BUST_W}
                height={BUST_H}
                fit="contain"
              />
            </SkiaGroup>
          )}
          <SkiaGroup transform={deformationMouthTransform}>
            <SkiaPath
              path={mouthFillPath}
              color="rgba(38,44,56,0.46)"
              opacity={mouthFillVisualOpacity}
            />
            <SkiaPath
              path={mouthLinePath}
              style="stroke"
              strokeWidth={1.1}
              strokeCap="round"
              color="rgba(236,242,250,0.2)"
              opacity={mouthLineVisualOpacity}
            />
          </SkiaGroup>

          {/* ⑩ Ghost oval rim — minimal separation from background */}
          {alphaImage === null && (
            <SkiaPath
              path={facePath}
              style="stroke"
              strokeWidth={0.9}
              color="rgba(224,236,248,0.08)"
              opacity={silhouetteRimOpacity}
            />
          )}

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
