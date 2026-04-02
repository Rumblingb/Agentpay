/**
 * AceFace — Ace's conversational avatar.
 *
 * Hologram aesthetic — white/silver on dark:
 *   - Near-transparent face shell with bright white rim (defining hologram feature)
 *   - Silver/chrome iris with near-white centre
 *   - Bright white mouth and specular highlights
 *   - Brighter glow halo that breathes silver-white
 *   - Bezier-curve mouth (smiles, compresses, speaks)
 *   - Top-down eyelid via clipped Rect
 *   - Corneal specular dot — single biggest "alive" signal
 *
 * All animation via react-native-reanimated useSharedValue /
 * useAnimatedProps — UI thread, no JS jank.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedProps,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  withSpring,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
// react-native-svg v15 was typed against @types/react v18; cast to fix v19 incompatibility
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _svg = require('react-native-svg') as Record<string, React.ComponentType<any>>;
const Svg           = _svg['default']        as React.ComponentType<any>;
const Defs          = _svg['Defs']           as React.ComponentType<any>;
const RadialGradient = _svg['RadialGradient'] as React.ComponentType<any>;
const LinearGradient = _svg['LinearGradient'] as React.ComponentType<any>;
const Stop          = _svg['Stop']           as React.ComponentType<any>;
const ClipPath      = _svg['ClipPath']       as React.ComponentType<any>;
const Ellipse       = _svg['Ellipse']        as React.ComponentType<any>;
const Circle        = _svg['Circle']         as React.ComponentType<any>;
const Rect          = _svg['Rect']           as React.ComponentType<any>;
const Path          = _svg['Path']           as React.ComponentType<any>;
const G             = _svg['G']              as React.ComponentType<any>;

import * as Haptics from 'expo-haptics';
import type { AppPhase } from '../lib/store';

// ─── Animated SVG components ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _svgRaw = require('react-native-svg');
// Cast to any: @types/react v19 broke createAnimatedComponent for SVG types (bigint in ReactNode)
// Runtime is correct — Reanimated handles animatedProps transparently.
const AnimatedG    = Animated.createAnimatedComponent(_svgRaw.G)    as unknown as React.ComponentType<any>;
const AnimatedRect = Animated.createAnimatedComponent(_svgRaw.Rect) as unknown as React.ComponentType<any>;
const AnimatedPath = Animated.createAnimatedComponent(_svgRaw.Path) as unknown as React.ComponentType<any>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  phase: AppPhase;
  isSpeaking: boolean;
  onPress?: () => void;
  disabled?: boolean;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const CW = 270;
const CH = 310;
const CX = CW / 2;   // 135
const CY = CH / 2;   // 155

// Face oval
const FRX = 76;
const FRY = 96;

// Glow + rings
const GLOW_R  = 128;
const RING_R  = 92;

// Eyes
const EYE_RX  = 16;    // sclera half-width
const EYE_RY  = 9;     // sclera half-height
const EYE_SEP = 27;    // horizontal offset from face centre
const EYE_Y_OFF = -18; // vertical offset from face centre (up)
const LEX = CX - EYE_SEP;  // 108 — left eye cx
const REX = CX + EYE_SEP;  // 162 — right eye cx
const EYE_CY = CY + EYE_Y_OFF; // 137 — eye cy

// Iris / pupil
const IRIS_R  = 8.5;
const PUP_R   = 5;

// Corneal specular highlight — top-right within iris
const SPEC_R  = 2.2;
const SPEC_OX = 3.6;
const SPEC_OY = -3.2;

// Eyelid: full travel in px when lid goes from fully open → fully closed
const LID_TOP = EYE_CY - EYE_RY - 8; // top of lid rect (above eye)
const LID_H_CLOSED = EYE_RY * 2 + 8; // height when fully closed

// Mouth
const MOUTH_CY = CY + 22;  // 177
const MOUTH_HW = 19;        // half-width

// ─── Phase helpers ────────────────────────────────────────────────────────────

// lid 0 = fully open (lid height = 0 relative to eye top)
// lid 1 = fully closed (lid covers entire eye)
function baseLidForPhase(p: AppPhase): number {
  if (p === 'listening')  return 0.0;
  if (p === 'thinking' || p === 'hiring' || p === 'executing') return 0.46;
  if (p === 'confirming') return 0.14;
  if (p === 'done')       return 0.34;
  if (p === 'error')      return 0.30;
  return 0.06; // idle
}

function baseGazeForPhase(p: AppPhase): { x: number; y: number } {
  if (p === 'thinking' || p === 'hiring' || p === 'executing') return { x: 0, y: -2 };
  if (p === 'done')  return { x: 0, y: 1.8 };
  if (p === 'error') return { x: 0, y: 0.6 };
  return { x: 0, y: 0 };
}

// positive = curves up (smile), negative = frown
function baseMouthCurveForPhase(p: AppPhase): number {
  if (p === 'done')      return 5.0;
  if (p === 'listening') return 1.0;
  if (p === 'thinking' || p === 'hiring' || p === 'executing') return -1.5;
  if (p === 'error')     return -2.5;
  return 0;
}

function baseMouthOpacityForPhase(p: AppPhase): number {
  if (p === 'done')       return 0.90;
  if (p === 'listening')  return 0.72;
  if (p === 'thinking' || p === 'hiring' || p === 'executing') return 0.32;
  if (p === 'confirming') return 0.52;
  if (p === 'error')      return 0.50;
  return 0.52;
}

// ─── Phase colour maps — hologram aesthetic (white/silver on dark) ────────────

const GLOW_COLOR: Record<AppPhase, string> = {
  idle:       '#c8e2ff',  // cold silver-white
  listening:  '#ffffff',  // pure white — alive
  thinking:   '#b4d0f8',  // silver
  confirming: '#f0ddb8',  // warm gold — premium warmth for confirmation
  hiring:     '#b4d0f8',
  executing:  '#c8e2ff',
  done:       '#aae8c4',  // soft mint green — success
  error:      '#f0b0b0',  // soft rose — error
};
const ACCENT: Record<AppPhase, string> = {
  idle:       '#e4f2ff',
  listening:  '#f8fbff',
  thinking:   '#d0e8f8',
  confirming: '#f4e8d0',
  hiring:     '#d0e8f8',
  executing:  '#e4f2ff',
  done:       '#ccf0e0',
  error:      '#f8e0e0',
};
// Face fill — near-transparent holographic shell
const FACE_TOP: Record<AppPhase, string> = {
  idle:       'rgba(192,218,252,0.10)',
  listening:  'rgba(216,236,255,0.16)',
  thinking:   'rgba(176,206,248,0.08)',
  confirming: 'rgba(244,222,180,0.10)',
  hiring:     'rgba(176,206,248,0.08)',
  executing:  'rgba(192,218,252,0.10)',
  done:       'rgba(178,230,206,0.10)',
  error:      'rgba(248,184,184,0.08)',
};
const FACE_BOT: Record<AppPhase, string> = {
  idle:       'rgba(150,188,232,0.05)',
  listening:  'rgba(168,206,254,0.09)',
  thinking:   'rgba(130,168,218,0.04)',
  confirming: 'rgba(218,190,140,0.06)',
  hiring:     'rgba(130,168,218,0.04)',
  executing:  'rgba(150,188,232,0.05)',
  done:       'rgba(140,206,172,0.05)',
  error:      'rgba(218,140,140,0.04)',
};
// Eyelid — matches app dark bg so it cleanly occludes the eye on close
const LID_FILL = 'rgba(7, 10, 18, 0.97)';

// ─── Component ────────────────────────────────────────────────────────────────

export function AceFace({ phase, isSpeaking, onPress, disabled }: Props) {

  // ── Shared values ────────────────────────────────────────────────────────
  const lidL       = useSharedValue(baseLidForPhase('idle'));
  const lidR       = useSharedValue(baseLidForPhase('idle'));
  const gazeX      = useSharedValue(0);
  const gazeY      = useSharedValue(0);
  const speechGX   = useSharedValue(0);
  const speechGY   = useSharedValue(0);
  const faceS      = useSharedValue(1);
  const faceLift   = useSharedValue(0);
  const glowO      = useSharedValue(0.32);
  const glowS      = useSharedValue(1);
  const ring1S     = useSharedValue(1);
  const ring1O     = useSharedValue(0);
  const ring2S     = useSharedValue(1);
  const ring2O     = useSharedValue(0);
  const mouthCurve = useSharedValue(0);
  const mouthO     = useSharedValue(0.52);

  // ── Derived animated props ───────────────────────────────────────────────

  // Face group transform: scale from centre + vertical lift
  const faceProps = useAnimatedProps(() => ({
    transform: [
      { translateX: CX }, { translateY: CY + faceLift.value },
      { scale: faceS.value },
      { translateX: -CX }, { translateY: -CY },
    ] as const,
  }));

  // Glow halo
  const glowProps = useAnimatedProps(() => ({
    transform: [
      { translateX: CX }, { translateY: CY },
      { scale: glowS.value },
      { translateX: -CX }, { translateY: -CY },
    ] as const,
    opacity: glowO.value,
  }));

  // Listening rings
  const ring1Props = useAnimatedProps(() => ({
    transform: [
      { translateX: CX }, { translateY: CY },
      { scale: ring1S.value },
      { translateX: -CX }, { translateY: -CY },
    ] as const,
    opacity: ring1O.value,
  }));
  const ring2Props = useAnimatedProps(() => ({
    transform: [
      { translateX: CX }, { translateY: CY },
      { scale: ring2S.value },
      { translateX: -CX }, { translateY: -CY },
    ] as const,
    opacity: ring2O.value,
  }));

  // Left eyelid height (0 = open, LID_H_CLOSED = fully shut)
  const lidLProps = useAnimatedProps(() => ({
    height: lidL.value * LID_H_CLOSED,
  }));
  const lidRProps = useAnimatedProps(() => ({
    height: lidR.value * LID_H_CLOSED,
  }));

  // Gaze translate for iris/pupil group
  const gazeCompositeX = useDerivedValue(() => gazeX.value + speechGX.value);
  const gazeCompositeY = useDerivedValue(() => gazeY.value + speechGY.value);

  const gazeGroupPropsL = useAnimatedProps(() => ({
    transform: [
      { translateX: LEX + gazeCompositeX.value },
      { translateY: EYE_CY + gazeCompositeY.value },
    ] as const,
  }));
  const gazeGroupPropsR = useAnimatedProps(() => ({
    transform: [
      { translateX: REX + gazeCompositeX.value },
      { translateY: EYE_CY + gazeCompositeY.value },
    ] as const,
  }));

  // Mouth bezier path — computed in worklet
  const mouthPathProps = useAnimatedProps(() => {
    const c  = mouthCurve.value;
    const x0 = CX - MOUTH_HW;
    const x3 = CX + MOUTH_HW;
    const y  = MOUTH_CY;
    const cp = y - c;
    return {
      d: `M ${x0} ${y} C ${x0 + MOUTH_HW * 0.5} ${cp} ${x3 - MOUTH_HW * 0.5} ${cp} ${x3} ${y}`,
      opacity: mouthO.value,
    };
  });

  // ── Phase animation effect ────────────────────────────────────────────────
  useEffect(() => {
    [
      lidL, lidR, gazeX, gazeY, faceS, faceLift,
      glowO, glowS, ring1S, ring1O, ring2S, ring2O,
      mouthCurve, mouthO,
    ].forEach(cancelAnimation);

    const T = (v: number, dur: number, ease = Easing.inOut(Easing.sin)) =>
      withTiming(v, { duration: dur, easing: ease });

    const baseLid  = baseLidForPhase(phase);
    const baseGaze = baseGazeForPhase(phase);

    lidL.value      = T(baseLid, 200);
    lidR.value      = T(baseLid, 200);
    gazeX.value     = T(baseGaze.x, 260);
    gazeY.value     = T(baseGaze.y, 260);
    mouthCurve.value = T(baseMouthCurveForPhase(phase), 240);
    mouthO.value     = T(baseMouthOpacityForPhase(phase), 220);
    ring1S.value = 1; ring1O.value = 0;
    ring2S.value = 1; ring2O.value = 0;

    // ── Idle ──────────────────────────────────────────────────────────────
    if (phase === 'idle') {
      // Hologram breathes brighter — silver pulse
      glowO.value = withRepeat(withSequence(T(0.58, 3200), T(0.24, 3200)), -1, false);
      glowS.value = withRepeat(withSequence(T(1.09, 3200), T(1, 3200)), -1, false);

      // Double blink every ~4 seconds
      const blink = withRepeat(withSequence(
        withDelay(3600, T(1, 82, Easing.in(Easing.quad))),
        T(baseLid, 110, Easing.out(Easing.quad)),
        withDelay(140, T(1, 70, Easing.in(Easing.quad))),
        T(baseLid, 100, Easing.out(Easing.quad)),
      ), -1, false);
      lidL.value = blink;
      lidR.value = withRepeat(withSequence(
        withDelay(3600, T(1, 82, Easing.in(Easing.quad))),
        T(baseLid, 110, Easing.out(Easing.quad)),
        withDelay(140, T(1, 70, Easing.in(Easing.quad))),
        T(baseLid, 100, Easing.out(Easing.quad)),
      ), -1, false);

      // Gaze wanders to corners
      gazeX.value = withRepeat(withSequence(
        T(-4, 2600), T(3.5, 2800), T(0, 2200),
      ), -1, false);
      gazeY.value = withRepeat(withSequence(
        T(-1.8, 2200), T(1.5, 2200), T(0, 2200),
      ), -1, false);

      faceLift.value = withRepeat(withSequence(T(-3, 2600), T(0, 2600)), -1, false);
    }

    // ── Listening ─────────────────────────────────────────────────────────
    if (phase === 'listening') {
      glowO.value = T(0.82, 300); // brighter pulse for hologram while listening
      // Ring 1
      ring1O.value = withRepeat(withSequence(
        T(0.28, 1, Easing.linear), T(0, 1800, Easing.in(Easing.quad)),
      ), -1, false);
      ring1S.value = withRepeat(withSequence(
        T(1, 1, Easing.linear), T(1.82, 1800, Easing.out(Easing.quad)),
      ), -1, false);
      // Ring 2: 900ms offset
      ring2O.value = withDelay(900, withRepeat(withSequence(
        T(0.25, 1, Easing.linear), T(0, 1800, Easing.in(Easing.quad)),
      ), -1, false));
      ring2S.value = withDelay(900, withRepeat(withSequence(
        T(1, 1, Easing.linear), T(1.82, 1800, Easing.out(Easing.quad)),
      ), -1, false));
      faceS.value = withRepeat(withSequence(T(1.028, 1100), T(1, 1100)), -1, false);
    }

    // ── Thinking / hiring / executing ─────────────────────────────────────
    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      glowS.value = withRepeat(withSequence(T(1.05, 1000), T(1, 1000)), -1, false);
      faceLift.value = withRepeat(withSequence(T(-2, 900), T(0, 900)), -1, false);
      // Asymmetric stagger blink
      lidL.value = withRepeat(withSequence(
        withDelay(2100, T(1, 105, Easing.in(Easing.quad))),
        T(baseLid, 145, Easing.out(Easing.quad)),
      ), -1, false);
      lidR.value = withRepeat(withSequence(
        withDelay(2148, T(1, 112, Easing.in(Easing.quad))),
        T(baseLid, 150, Easing.out(Easing.quad)),
      ), -1, false);
    }

    // ── Confirming ────────────────────────────────────────────────────────
    if (phase === 'confirming') {
      glowO.value = T(0.52, 380);
    }

    // ── Done ──────────────────────────────────────────────────────────────
    if (phase === 'done') {
      faceS.value    = withSpring(1.05, { damping: 14, stiffness: 180 });
      faceLift.value = withSpring(-4,   { damping: 12, stiffness: 150 });
      glowO.value    = T(0.66, 380);
    }

    // ── Error ─────────────────────────────────────────────────────────────
    if (phase === 'error') {
      glowO.value = T(0.54, 300);
    }
  }, [
    faceLift, faceS, gazeX, gazeY, glowO, glowS,
    lidL, lidR, mouthCurve, mouthO, phase,
    ring1O, ring1S, ring2O, ring2S,
  ]);

  // ── Speaking animation ───────────────────────────────────────────────────
  useEffect(() => {
    [mouthCurve, speechGX, speechGY].forEach(cancelAnimation);

    if (isSpeaking) {
      mouthCurve.value = withRepeat(withSequence(
        withTiming(5.5,  { duration: 135, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.8,  { duration: 145, easing: Easing.inOut(Easing.sin) }),
        withTiming(4.2,  { duration: 125, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.5,  { duration: 162, easing: Easing.inOut(Easing.sin) }),
      ), -1, false);
      mouthO.value = withTiming(0.96, { duration: 180 });

      // Micro-saccades
      speechGX.value = withRepeat(withSequence(
        withTiming(-1.1, { duration: 118, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0,  { duration: 108, easing: Easing.inOut(Easing.sin) }),
        withTiming(0,    { duration: 88,  easing: Easing.inOut(Easing.sin) }),
        withDelay(320, withTiming(0, { duration: 10 })),
      ), -1, false);
      speechGY.value = withRepeat(withSequence(
        withTiming(0.5,  { duration: 118, easing: Easing.inOut(Easing.sin) }),
        withTiming(-0.4, { duration: 108, easing: Easing.inOut(Easing.sin) }),
        withTiming(0,    { duration: 88,  easing: Easing.inOut(Easing.sin) }),
        withDelay(320, withTiming(0, { duration: 10 })),
      ), -1, false);
    } else {
      mouthCurve.value = withTiming(baseMouthCurveForPhase(phase), { duration: 260 });
      mouthO.value     = withTiming(baseMouthOpacityForPhase(phase), { duration: 220 });
      speechGX.value   = withTiming(0, { duration: 140 });
      speechGY.value   = withTiming(0, { duration: 140 });
    }

    return () => { [mouthCurve, speechGX, speechGY].forEach(cancelAnimation); };
  }, [isSpeaking, mouthCurve, mouthO, phase, speechGX, speechGY]);

  // ── Colours ───────────────────────────────────────────────────────────────
  const glowColor   = GLOW_COLOR[phase] ?? '#c8e2ff';
  const accentColor = ACCENT[phase]     ?? '#e4f2ff';
  const faceTop     = FACE_TOP[phase]   ?? 'rgba(192,218,252,0.10)';
  const faceBot     = FACE_BOT[phase]   ?? 'rgba(150,188,232,0.05)';
  const lidColor    = LID_FILL;

  const isInteractive = phase !== 'done';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Pressable onPress={handlePress} disabled={disabled || !isInteractive} style={styles.container}>
      <Svg width={CW} height={CH}>
          <Defs>
            {/* Face body gradient — near-transparent holographic shell */}
            <LinearGradient id="faceGrad" x1="0.2" y1="0.1" x2="0.85" y2="0.9">
              <Stop offset="0" stopColor={faceTop} stopOpacity="1" />
              <Stop offset="1" stopColor={faceBot} stopOpacity="1" />
            </LinearGradient>

            {/* Key light — top-left specular (hologram gleam) */}
            <RadialGradient id="keyLight" cx="35%" cy="30%" r="55%">
              <Stop offset="0" stopColor="rgba(255,255,255,1)" stopOpacity="0.22" />
              <Stop offset="1" stopColor="rgba(255,255,255,0)" stopOpacity="0" />
            </RadialGradient>

            {/* Rim/fill light — bottom-right hologram scatter */}
            <RadialGradient id="rimLight" cx="72%" cy="75%" r="48%">
              <Stop offset="0" stopColor={glowColor} stopOpacity="0.22" />
              <Stop offset="1" stopColor={glowColor} stopOpacity="0" />
            </RadialGradient>

            {/* Glow halo — brighter for hologram */}
            <RadialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0"    stopColor={glowColor} stopOpacity="0.72" />
              <Stop offset="0.55" stopColor={glowColor} stopOpacity="0.26" />
              <Stop offset="1"    stopColor={glowColor} stopOpacity="0" />
            </RadialGradient>

            {/* Sclera — crisp white with subtle limbal ring */}
            <RadialGradient id="scleraGrad" cx="48%" cy="42%" r="58%">
              <Stop offset="0"    stopColor="rgba(248,252,255,0.99)" stopOpacity="1" />
              <Stop offset="0.68" stopColor="rgba(215,236,254,0.97)" stopOpacity="1" />
              <Stop offset="1"    stopColor="rgba(168,204,238,0.86)" stopOpacity="1" />
            </RadialGradient>

            {/* Iris — silver/chrome hologram */}
            <RadialGradient id="irisGrad" cx="42%" cy="38%" r="60%">
              <Stop offset="0"    stopColor="rgba(232,248,255,0.98)" stopOpacity="1" />
              <Stop offset="0.28" stopColor="#96b8d8" stopOpacity="1" />
              <Stop offset="0.70" stopColor="#486880" stopOpacity="1" />
              <Stop offset="1"    stopColor="#102030" stopOpacity="1" />
            </RadialGradient>

            {/* Face oval clip */}
            <ClipPath id="faceClip">
              <Ellipse cx={CX} cy={CY} rx={FRX - 0.5} ry={FRY - 0.5} />
            </ClipPath>

            {/* Eye clips */}
            <ClipPath id="eyeClipL">
              <Ellipse cx={LEX} cy={EYE_CY} rx={EYE_RX} ry={EYE_RY} />
            </ClipPath>
            <ClipPath id="eyeClipR">
              <Ellipse cx={REX} cy={EYE_CY} rx={EYE_RX} ry={EYE_RY} />
            </ClipPath>
          </Defs>

          {/* ── Glow halo ── */}
          <AnimatedG animatedProps={glowProps as any}>
            <Circle cx={CX} cy={CY} r={GLOW_R} fill="url(#glowGrad)" />
          </AnimatedG>

          {/* ── Listening rings ── */}
          <AnimatedG animatedProps={ring1Props as any}>
            <Circle cx={CX} cy={CY} r={RING_R}
              fill="none" stroke={accentColor} strokeWidth={1.6} strokeOpacity={0.9} />
          </AnimatedG>
          <AnimatedG animatedProps={ring2Props as any}>
            <Circle cx={CX} cy={CY} r={RING_R}
              fill="none" stroke={accentColor} strokeWidth={1.2} strokeOpacity={0.7} />
          </AnimatedG>

          {/* ── Face body ── */}
          <AnimatedG animatedProps={faceProps as any}>
            {/* Base fill — near-transparent holographic shell */}
            <Ellipse cx={CX} cy={CY} rx={FRX} ry={FRY} fill="url(#faceGrad)" />

            {/* Key light overlay — strong specular gleam */}
            <Ellipse cx={CX} cy={CY} rx={FRX} ry={FRY}
              fill="url(#keyLight)" clipPath="url(#faceClip)" />

            {/* Rim/fill light overlay */}
            <Ellipse cx={CX} cy={CY} rx={FRX} ry={FRY}
              fill="url(#rimLight)" clipPath="url(#faceClip)" />

            {/* ── Left eye ── */}
            <G clipPath="url(#eyeClipL)">
              {/* Sclera */}
              <Ellipse cx={LEX} cy={EYE_CY} rx={EYE_RX} ry={EYE_RY} fill="url(#scleraGrad)" />
              {/* Iris + pupil + specular — animated with gaze */}
              <AnimatedG animatedProps={gazeGroupPropsL as any}>
                <Circle cx={0} cy={0} r={IRIS_R} fill="url(#irisGrad)" />
                <Circle cx={0} cy={0} r={PUP_R} fill="#04101e" />
                <Circle cx={SPEC_OX} cy={SPEC_OY} r={SPEC_R} fill="rgba(255,255,255,0.97)" />
              </AnimatedG>
              {/* Eyelid — slides from top, matches app dark bg */}
              <AnimatedRect
                x={LEX - EYE_RX - 2}
                y={LID_TOP}
                width={EYE_RX * 2 + 4}
                fill={lidColor}
                animatedProps={lidLProps as any}
              />
            </G>

            {/* ── Right eye ── */}
            <G clipPath="url(#eyeClipR)">
              <Ellipse cx={REX} cy={EYE_CY} rx={EYE_RX} ry={EYE_RY} fill="url(#scleraGrad)" />
              <AnimatedG animatedProps={gazeGroupPropsR as any}>
                <Circle cx={0} cy={0} r={IRIS_R} fill="url(#irisGrad)" />
                <Circle cx={0} cy={0} r={PUP_R} fill="#04101e" />
                <Circle cx={SPEC_OX} cy={SPEC_OY} r={SPEC_R} fill="rgba(255,255,255,0.97)" />
              </AnimatedG>
              <AnimatedRect
                x={REX - EYE_RX - 2}
                y={LID_TOP}
                width={EYE_RX * 2 + 4}
                fill={lidColor}
                animatedProps={lidRProps as any}
              />
            </G>

            {/* ── Mouth — cubic bezier, bright white hologram line ── */}
            <AnimatedPath
              fill="none"
              stroke="rgba(255,255,255,0.90)"
              strokeWidth={4.5}
              strokeLinecap="round"
              animatedProps={mouthPathProps as any}
            />

            {/* Face border — bright white hologram rim (THE defining hologram feature) */}
            <Ellipse cx={CX} cy={CY} rx={FRX} ry={FRY}
              fill="none" stroke="rgba(248,252,255,0.86)" strokeWidth={1.2} />
            {/* Inner inset rim — subtle hologram depth */}
            <Ellipse cx={CX} cy={CY} rx={FRX - 3} ry={FRY - 3}
              fill="none" stroke="rgba(210,234,255,0.28)" strokeWidth={1} />
          </AnimatedG>
        </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CW,
    height: CH,
    alignSelf: 'center',
  },
});
