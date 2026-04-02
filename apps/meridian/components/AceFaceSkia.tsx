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
 *   5. Key light               — top-left white radial, fixed
 *   6. Rim light               — bottom-right, phase-tinted
 *   7. Inner shadow            — bottom depth
 *   8. Mouth bezier            — GPU-computed path, speaking only
 *   9. Ghost oval rim          — ultra-thin separation
 *  10. Audio-reactive corona   — ring responding to real mic/TTS amplitude
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

interface Props {
  phase: AppPhase;
  isSpeaking: boolean;
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
const RING_R  = 116;  // Starts outside the face oval edge — no mic-button shape
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
  if (phase === 'done') return 0.82;
  if (phase === 'error') return 0.48;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.36;
  if (phase === 'listening') return 0.3;
  return 0.28;
}

function baseTextureOpacity(phase: AppPhase): number {
  if (phase === 'listening') return 0.86;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.88;
  if (phase === 'confirming') return 0.78;
  if (phase === 'done') return 0.82;
  if (phase === 'error') return 0.66;
  return 0.78;
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
  micAmplitude,
  ttsAmplitude,
  onPress,
  disabled,
}: Props) {
  const bustImage = useImage(require('../assets/ace-face-render.png'));
  const facePath  = useMemo(() => Skia.Path.MakeFromSVGString(FACE_PATH_SVG), []);

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
  const mouthCurve   = useSharedValue(baseMouthCurve('idle'));
  const mouthOp      = useSharedValue(0);
  const coronaActive = useSharedValue(0); // 0–1, drives corona visibility

  const glowColor   = GLOW_COLOR[phase]   ?? '#eef4ff';
  const accentColor = ACCENT_COLOR[phase] ?? '#dbe6f6';

  // ─── Derived transforms (UI thread) ──────────────────────────────────────

  const glowTransform = useDerivedValue(() => [
    { translateX: CX }, { translateY: CY },
    { scale: glowScale.value },
    { translateX: -CX }, { translateY: -CY },
  ]);

  const faceTransform = useDerivedValue(() => [
    { translateX: CX }, { translateY: CY + faceLift.value },
    { scale: faceScale.value },
    { translateX: -CX }, { translateY: -CY },
  ]);

  const ring1Transform = useDerivedValue(() => [
    { translateX: CX }, { translateY: CY },
    { scale: ring1Scale.value },
    { translateX: -CX }, { translateY: -CY },
  ]);

  const ring2Transform = useDerivedValue(() => [
    { translateX: CX }, { translateY: CY },
    { scale: ring2Scale.value },
    { translateX: -CX }, { translateY: -CY },
  ]);

  // ─── Audio-reactive corona (UI thread, every frame) ───────────────────────

  const coronaRadius = useDerivedValue(() => {
    const mic = micAmplitude?.value ?? 0;
    const tts = ttsAmplitude?.value ?? 0;
    return 108 + Math.max(mic, tts) * 18;
  });

  const coronaOpacity = useDerivedValue(() => {
    const mic = micAmplitude?.value ?? 0;
    const tts = ttsAmplitude?.value ?? 0;
    return coronaActive.value * (0.08 + Math.max(mic, tts) * 0.54);
  });

  // ─── GPU-computed mouth path (UI thread) ─────────────────────────────────

  const mouthPath = useDerivedValue(() => {
    const curve = mouthCurve.value;
    const path  = Skia.Path.Make();
    const x0 = CX - MOUTH_HW;
    const x3 = CX + MOUTH_HW;
    const y  = MOUTH_Y;
    const cp = y - curve;
    path.moveTo(x0, y);
    path.cubicTo(
      x0 + MOUTH_HW * 0.52, cp,
      x3 - MOUTH_HW * 0.52, cp,
      x3, y,
    );
    return path;
  });

  // ─── Phase animation ──────────────────────────────────────────────────────

  useEffect(() => {
    [
      faceScale, faceLift, glowOpacity, glowScale,
      ring1Scale, ring1Opacity, ring2Scale, ring2Opacity,
      textureOp, mouthCurve, mouthOp, coronaActive,
    ].forEach(cancelAnimation);

    const t = (val: number, ms: number, easing = Easing.inOut(Easing.sin)) =>
      withTiming(val, { duration: ms, easing });

    faceScale.value    = t(1, 220);
    faceLift.value     = t(0, 220);
    glowScale.value    = t(1, 220);
    glowOpacity.value  = t(0.22, 220);
    ring1Scale.value   = 1;
    ring1Opacity.value = 0;
    ring2Scale.value   = 1;
    ring2Opacity.value = 0;
    textureOp.value    = t(baseTextureOpacity(phase), 240);
    mouthCurve.value   = t(baseMouthCurve(phase), 220);
    mouthOp.value      = t(baseMouthOpacity(phase), 220);
    coronaActive.value = t(phase === 'listening' ? 1 : 0, 200);

    if (phase === 'idle') {
      glowOpacity.value = withRepeat(withSequence(t(0.32, 2600), t(0.14, 2600)), -1, false);
      glowScale.value   = withRepeat(withSequence(t(1.07, 2600), t(1, 2600)), -1, false);
      faceLift.value    = withRepeat(withSequence(t(-3, 2400), t(0, 2400)), -1, false);
      textureOp.value   = withRepeat(withSequence(t(0.84, 2400), t(0.72, 2400)), -1, false);
    }

    if (phase === 'listening') {
      glowOpacity.value  = t(0.52, 280);
      faceScale.value    = withRepeat(withSequence(t(1.022, 1050), t(1, 1050)), -1, false);
      textureOp.value    = withRepeat(withSequence(t(0.90, 900), t(0.80, 900)), -1, false);
      ring1Opacity.value = withRepeat(withSequence(
        t(0.22, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false);
      ring1Scale.value = withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(1.72, 1800, Easing.out(Easing.quad)),
      ), -1, false);
      ring2Opacity.value = withDelay(900, withRepeat(withSequence(
        t(0.14, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false));
      ring2Scale.value = withDelay(900, withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(1.72, 1800, Easing.out(Easing.quad)),
      ), -1, false));
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      glowOpacity.value = withRepeat(withSequence(t(0.48, 900), t(0.24, 900)), -1, false);
      glowScale.value   = withRepeat(withSequence(t(1.09, 900), t(1, 900)), -1, false);
      faceLift.value    = withRepeat(withSequence(t(-2, 900), t(0, 900)), -1, false);
      textureOp.value   = withRepeat(withSequence(t(0.92, 760), t(0.82, 760)), -1, false);
    }

    if (phase === 'confirming') {
      glowOpacity.value = t(0.38, 320);
      textureOp.value   = t(0.78, 320);
    }

    if (phase === 'done') {
      faceScale.value   = withSpring(1.04, { damping: 14, stiffness: 180 });
      faceLift.value    = withSpring(-4,   { damping: 12, stiffness: 150 });
      glowOpacity.value = t(0.44, 320);
      textureOp.value   = t(0.82, 320);
    }

    if (phase === 'error') {
      glowOpacity.value = t(0.28, 260);
      textureOp.value   = t(0.66, 260);
    }
  }, [
    phase,
    faceScale, faceLift, glowOpacity, glowScale,
    ring1Scale, ring1Opacity, ring2Scale, ring2Opacity,
    textureOp, mouthCurve, mouthOp, coronaActive,
  ]);

  // ─── Speaking animation ───────────────────────────────────────────────────

  useEffect(() => {
    [mouthCurve, mouthOp, coronaActive].forEach(cancelAnimation);

    const t = (val: number, ms: number) =>
      withTiming(val, { duration: ms, easing: Easing.inOut(Easing.sin) });

    if (isSpeaking) {
      mouthCurve.value   = withRepeat(withSequence(
        t(4.8, 130), t(0.8, 145), t(4.0, 120), t(0.2, 150),
      ), -1, false);
      mouthOp.value      = t(0.96, 120);
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
            style="stroke" strokeWidth={1.4}
            color={accentColor}
          />
        </SkiaGroup>
        <SkiaGroup opacity={ring2Opacity} transform={ring2Transform}>
          <SkiaCircle
            cx={CX} cy={CY} r={RING_R}
            style="stroke" strokeWidth={1.1}
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
              <SkiaImage
                image={bustImage}
                x={-6} y={4}
                width={282} height={298}
                fit="contain"
              />
            )}
          </SkiaGroup>

          {/* ⑤ Key light — top-left directional */}
          <SkiaGroup clip={facePath}>
            <SkiaCircle cx={82} cy={76} r={156}>
              <RadialGradient
                c={vec(82, 76)} r={156}
                colors={['rgba(255,255,255,0.26)', 'transparent']}
              />
            </SkiaCircle>
          </SkiaGroup>

          {/* ⑥ Rim light — bottom-right, phase-tinted */}
          <SkiaGroup clip={facePath}>
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

          {/* ⑧ Mouth — GPU-computed bezier, animated on speaking */}
          <SkiaPath
            path={mouthPath}
            style="stroke"
            strokeWidth={2.8}
            strokeCap="round"
            color="rgba(230,244,255,0.98)"
            opacity={mouthOp}
          />

          {/* ⑨ Ghost oval rim — minimal separation from background */}
          <SkiaPath
            path={facePath}
            style="stroke"
            strokeWidth={1}
            color="rgba(200,225,255,0.07)"
          />

        </SkiaGroup>

        {/* ⑩ Audio-reactive corona — reacts every frame to real amplitude */}
        <SkiaCircle
          cx={CX} cy={CY}
          r={coronaRadius}
          style="stroke"
          strokeWidth={2}
          color={accentColor}
          opacity={coronaOpacity}
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
