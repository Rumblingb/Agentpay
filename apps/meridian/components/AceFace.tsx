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

// ─── Phase colour maps — dark obsidian glass, lit from above-left ─────────────
//
// Material language: polished dark stone under directional light.
// Like a black opal or a wet obsidian surface.
// The face has mass and depth — not a ghost, not a hologram.

const GLOW_COLOR: Record<AppPhase, string> = {
  idle:       '#e7f1ff',
  listening:  '#ffffff',
  thinking:   '#dce9fb',
  confirming: '#fff0d6',
  hiring:     '#dce9fb',
  executing:  '#ecf4ff',
  done:       '#ecfff4',
  error:      '#ffe7eb',
};

const ACCENT: Record<AppPhase, string> = {
  idle:       '#f3f8ff',
  listening:  '#ffffff',
  thinking:   '#eef5ff',
  confirming: '#fff7eb',
  hiring:     '#eef5ff',
  executing:  '#f4f9ff',
  done:       '#f5fff8',
  error:      '#fff3f5',
};

// Face body: rich dark gradient — top-left lit, bottom-right recedes into shadow.
// These are solid, opaque colours. The face has genuine material presence.
const FACE_TOP: Record<AppPhase, string> = {
  idle:       '#f5f9ff',
  listening:  '#ffffff',
  thinking:   '#edf4ff',
  confirming: '#fff9ef',
  hiring:     '#edf4ff',
  executing:  '#f5f9ff',
  done:       '#f2fff7',
  error:      '#fff2f4',
};
const FACE_BOT: Record<AppPhase, string> = {
  idle:       '#9eafc5',
  listening:  '#b2c3d8',
  thinking:   '#95a7c0',
  confirming: '#c7b79c',
  hiring:     '#95a7c0',
  executing:  '#a8b8cc',
  done:       '#9bbfb0',
  error:      '#c9a7af',
};

// Eyelid colour tracks face top — seamless, same material
const LID_FILL_MAP: Record<AppPhase, string> = {
  idle:       '#b2c0d3',
  listening:  '#c0cede',
  thinking:   '#a8b7ca',
  confirming: '#cabda8',
  hiring:     '#a8b7ca',
  executing:  '#b8c6d8',
  done:       '#aacaba',
  error:      '#cfb2b9',
};

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
  const fieldS     = useSharedValue(1);
  const fieldO     = useSharedValue(0.18);
  const filamentO  = useSharedValue(0.1);
  const mouthCurve = useSharedValue(0);
  const mouthO     = useSharedValue(0.52);

  // ── Derived animated props ───────────────────────────────────────────────

  // Face group transform: scale from centre + vertical lift
  const faceProps = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY + faceLift.value}) scale(${faceS.value}) translate(${-CX} ${-CY})`,
  }));

  // Glow halo
  const glowProps = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${glowS.value}) translate(${-CX} ${-CY})`,
    opacity: glowO.value,
  }));

  // Listening rings
  const ring1Props = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${ring1S.value}) translate(${-CX} ${-CY})`,
    opacity: ring1O.value,
  }));
  const ring2Props = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${ring2S.value}) translate(${-CX} ${-CY})`,
    opacity: ring2O.value,
  }));

  const fieldProps = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${fieldS.value}) translate(${-CX} ${-CY})`,
    opacity: fieldO.value,
  }));

  const filamentProps = useAnimatedProps(() => ({
    opacity: filamentO.value,
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
    transform: `translate(${LEX + gazeCompositeX.value} ${EYE_CY + gazeCompositeY.value})`,
  }));
  const gazeGroupPropsR = useAnimatedProps(() => ({
    transform: `translate(${REX + gazeCompositeX.value} ${EYE_CY + gazeCompositeY.value})`,
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
      glowO, glowS, ring1S, ring1O, ring2S, ring2O, fieldS, fieldO, filamentO,
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
    fieldS.value = T(1, 220);
    fieldO.value = T(0.18, 220);
    filamentO.value = T(0.1, 220);

    // ── Idle ──────────────────────────────────────────────────────────────
    if (phase === 'idle') {
      // Hologram breathes brighter — silver pulse
      glowO.value = withRepeat(withSequence(T(0.44, 3200), T(0.16, 3200)), -1, false);
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
      fieldO.value = withRepeat(withSequence(T(0.18, 2800), T(0.12, 2800)), -1, false);
      filamentO.value = withRepeat(withSequence(T(0.12, 2800), T(0.06, 2800)), -1, false);
    }

    // ── Listening ─────────────────────────────────────────────────────────
    if (phase === 'listening') {
      glowO.value = T(0.62, 300);
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
      fieldS.value = withRepeat(withSequence(T(1.018, 1100), T(1, 1100)), -1, false);
      fieldO.value = T(0.24, 280);
      filamentO.value = withRepeat(withSequence(T(0.18, 820), T(0.1, 820)), -1, false);
    }

    // ── Thinking / hiring / executing ─────────────────────────────────────
    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      glowS.value = withRepeat(withSequence(T(1.05, 1000), T(1, 1000)), -1, false);
      faceLift.value = withRepeat(withSequence(T(-2, 900), T(0, 900)), -1, false);
      fieldS.value = withRepeat(withSequence(T(1.024, 900), T(1, 900)), -1, false);
      fieldO.value = withRepeat(withSequence(T(0.3, 900), T(0.16, 900)), -1, false);
      filamentO.value = withRepeat(withSequence(T(0.28, 760), T(0.12, 760)), -1, false);
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
      fieldO.value = T(0.2, 320);
      filamentO.value = T(0.11, 320);
    }

    // ── Done ──────────────────────────────────────────────────────────────
    if (phase === 'done') {
      faceS.value    = withSpring(1.05, { damping: 14, stiffness: 180 });
      faceLift.value = withSpring(-4,   { damping: 12, stiffness: 150 });
      glowO.value    = T(0.66, 380);
      fieldO.value   = T(0.22, 320);
      filamentO.value = T(0.13, 320);
    }

    // ── Error ─────────────────────────────────────────────────────────────
    if (phase === 'error') {
      glowO.value = T(0.54, 300);
      fieldO.value = T(0.14, 260);
      filamentO.value = T(0.08, 260);
    }
  }, [
    faceLift, faceS, gazeX, gazeY, glowO, glowS,
    fieldO, fieldS, filamentO, lidL, lidR, mouthCurve, mouthO, phase,
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
  const lidColor    = LID_FILL_MAP[phase] ?? '#1e2f42';

  const isInteractive = phase !== 'done';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Pressable onPress={handlePress} disabled={disabled || !isInteractive} style={styles.container}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${CW} ${CH}`}
        preserveAspectRatio="xMidYMid meet"
      >
          <Defs>
            {/* Face body — opaque dark glass, lit from top-left */}
            <LinearGradient id="faceGrad" x1="0.18" y1="0.08" x2="0.88" y2="0.92">
              <Stop offset="0"    stopColor={faceTop} stopOpacity="0.26" />
              <Stop offset="0.52" stopColor={accentColor} stopOpacity="0.10" />
              <Stop offset="1"    stopColor={faceBot} stopOpacity="0.20" />
            </LinearGradient>

            {/* Key light — directional top-left specular (3D mass illusion) */}
            <RadialGradient id="keyLight" cx="30%" cy="25%" r="52%">
              <Stop offset="0"   stopColor="rgba(255,255,255,1)" stopOpacity="0.24" />
              <Stop offset="0.6" stopColor="rgba(255,255,255,1)" stopOpacity="0.07" />
              <Stop offset="1"   stopColor="rgba(255,255,255,0)" stopOpacity="0" />
            </RadialGradient>

            {/* Secondary fill — bottom-right rim scatter (bounce light) */}
            <RadialGradient id="rimLight" cx="76%" cy="80%" r="45%">
              <Stop offset="0"   stopColor={glowColor} stopOpacity="0.22" />
              <Stop offset="1"   stopColor={glowColor} stopOpacity="0" />
            </RadialGradient>

            <RadialGradient id="shellShadow" cx="54%" cy="76%" r="52%">
              <Stop offset="0"    stopColor="rgba(34,46,66,1)" stopOpacity="0.28" />
              <Stop offset="0.55" stopColor="rgba(34,46,66,1)" stopOpacity="0.10" />
              <Stop offset="1"    stopColor="rgba(34,46,66,0)" stopOpacity="0" />
            </RadialGradient>

            <RadialGradient id="mindCore" cx="50%" cy="34%" r="54%">
              <Stop offset="0"    stopColor="rgba(255,255,255,1)" stopOpacity="0.34" />
              <Stop offset="0.45" stopColor="rgba(228,238,252,1)" stopOpacity="0.16" />
              <Stop offset="1"    stopColor="rgba(228,238,252,0)" stopOpacity="0" />
            </RadialGradient>

            <LinearGradient id="filamentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0"    stopColor="rgba(255,255,255,0)" stopOpacity="0" />
              <Stop offset="0.18" stopColor="rgba(250,252,255,1)" stopOpacity="0.38" />
              <Stop offset="0.5"  stopColor="rgba(228,238,250,1)" stopOpacity="0.92" />
              <Stop offset="0.82" stopColor="rgba(250,252,255,1)" stopOpacity="0.34" />
              <Stop offset="1"    stopColor="rgba(255,255,255,0)" stopOpacity="0" />
            </LinearGradient>

            {/* Glow halo — measured, not blown out */}
            <RadialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0"    stopColor={glowColor} stopOpacity="0.52" />
              <Stop offset="0.5"  stopColor={glowColor} stopOpacity="0.18" />
              <Stop offset="1"    stopColor={glowColor} stopOpacity="0" />
            </RadialGradient>

            {/* Sclera — warm white, limbal shadow ring for depth */}
            <RadialGradient id="scleraGrad" cx="46%" cy="40%" r="56%">
              <Stop offset="0"    stopColor="rgba(255,255,255,0.98)" stopOpacity="1" />
              <Stop offset="0.65" stopColor="rgba(232,240,248,0.96)" stopOpacity="1" />
              <Stop offset="1"    stopColor="rgba(194,207,222,0.86)" stopOpacity="1" />
            </RadialGradient>

            {/* Iris — deep blue-grey jewel: 4-stop for genuine depth */}
            <RadialGradient id="irisGrad" cx="40%" cy="36%" r="62%">
              <Stop offset="0"    stopColor="#f8fbff" stopOpacity="1" />
              <Stop offset="0.22" stopColor="#cfdbe8" stopOpacity="1" />
              <Stop offset="0.66" stopColor="#7d90ab" stopOpacity="1" />
              <Stop offset="1"    stopColor="#24354c" stopOpacity="1" />
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

            {/* Lower shell shadow - keeps the silver face dimensional */}
            <Ellipse cx={CX} cy={CY} rx={FRX} ry={FRY}
              fill="url(#shellShadow)" clipPath="url(#faceClip)" />

            {/* Interior mind field - brain of Ace, but quiet and luxurious */}
            <AnimatedG animatedProps={fieldProps as any} clipPath="url(#faceClip)">
              <Ellipse cx={CX} cy={CY - 18} rx={46} ry={58} fill="url(#mindCore)" />
              <Ellipse cx={CX} cy={CY + 30} rx={34} ry={52} fill="url(#mindCore)" opacity={0.42} />
            </AnimatedG>

            <AnimatedG animatedProps={filamentProps as any} clipPath="url(#faceClip)">
              <Path
                d="M 135 72 C 132 98 132 122 135 148 C 138 176 138 206 135 242"
                fill="none"
                stroke="url(#filamentGrad)"
                strokeWidth={1.35}
                strokeLinecap="round"
              />
              <Path
                d="M 112 90 C 122 80 148 80 158 90"
                fill="none"
                stroke="url(#filamentGrad)"
                strokeWidth={1.15}
                strokeLinecap="round"
              />
              <Path
                d="M 103 112 C 114 100 124 96 135 96"
                fill="none"
                stroke="url(#filamentGrad)"
                strokeWidth={1.05}
                strokeLinecap="round"
              />
              <Path
                d="M 167 112 C 156 100 146 96 135 96"
                fill="none"
                stroke="url(#filamentGrad)"
                strokeWidth={1.05}
                strokeLinecap="round"
              />
              <Path
                d="M 108 154 C 120 168 124 188 123 220"
                fill="none"
                stroke="url(#filamentGrad)"
                strokeWidth={1.0}
                strokeLinecap="round"
              />
              <Path
                d="M 162 154 C 150 168 146 188 147 220"
                fill="none"
                stroke="url(#filamentGrad)"
                strokeWidth={1.0}
                strokeLinecap="round"
              />
              <Circle cx={135} cy={104} r={1.9} fill="rgba(255,255,255,0.82)" />
              <Circle cx={123} cy={172} r={1.5} fill="rgba(248,251,255,0.64)" />
              <Circle cx={147} cy={172} r={1.5} fill="rgba(248,251,255,0.64)" />
            </AnimatedG>

            {/* ── Left eye ── */}
            <G clipPath="url(#eyeClipL)">
              {/* Sclera */}
              <Ellipse cx={LEX} cy={EYE_CY} rx={EYE_RX} ry={EYE_RY} fill="url(#scleraGrad)" />
              {/* Iris + pupil + specular — animated with gaze */}
              <AnimatedG animatedProps={gazeGroupPropsL as any}>
                <Circle cx={0} cy={0} r={IRIS_R} fill="url(#irisGrad)" />
                <Circle cx={0} cy={0} r={PUP_R} fill="#0b1320" />
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
                <Circle cx={0} cy={0} r={PUP_R} fill="#0b1320" />
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

            {/* ── Mouth — cubic bezier, soft ice-blue stroke ── */}
            <AnimatedPath
              fill="none"
              stroke="rgba(248,251,255,0.94)"
              strokeWidth={4.2}
              strokeLinecap="round"
              animatedProps={mouthPathProps as any}
            />

            {/* Face border — fine blue-white rim, like polished glass edge */}
            <Ellipse cx={CX} cy={CY} rx={FRX} ry={FRY}
              fill="none" stroke="rgba(246,250,255,0.72)" strokeWidth={1.05} />
            {/* Inner inset rim — glass depth, barely visible */}
            <Ellipse cx={CX} cy={CY} rx={FRX - 3} ry={FRY - 3}
              fill="none" stroke="rgba(226,236,248,0.22)" strokeWidth={1} />
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
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
});
