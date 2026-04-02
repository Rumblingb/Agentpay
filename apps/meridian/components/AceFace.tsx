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
  idle:       '#7ab8e0',  // cool steel blue
  listening:  '#a8d8f8',  // bright ice blue — attention
  thinking:   '#5a9acc',  // deeper blue — processing
  confirming: '#c8a060',  // warm amber — trust, payment
  hiring:     '#5a9acc',
  executing:  '#7ab8e0',
  done:       '#72c890',  // emerald — success
  error:      '#d06868',  // rose — gentle alert
};

const ACCENT: Record<AppPhase, string> = {
  idle:       '#a0cce8',
  listening:  '#c4e8fc',
  thinking:   '#84b8e0',
  confirming: '#dcc080',
  hiring:     '#84b8e0',
  executing:  '#a0cce8',
  done:       '#8ed8a8',
  error:      '#e09090',
};

// Face body: rich dark gradient — top-left lit, bottom-right recedes into shadow.
// These are solid, opaque colours. The face has genuine material presence.
const FACE_TOP: Record<AppPhase, string> = {
  idle:       '#1e2f42',   // deep steel blue-grey
  listening:  '#192840',   // slightly deeper, more focused
  thinking:   '#131e32',   // near-midnight — concentration
  confirming: '#28200e',   // dark amber — warmth of decision
  hiring:     '#131e32',
  executing:  '#1e2f42',
  done:       '#132618',   // deep forest — satisfaction
  error:      '#280e0e',   // deep crimson — alert
};
const FACE_BOT: Record<AppPhase, string> = {
  idle:       '#080f18',
  listening:  '#081018',
  thinking:   '#060b12',
  confirming: '#110d06',
  hiring:     '#060b12',
  executing:  '#080f18',
  done:       '#060e08',
  error:      '#0e0606',
};

// Eyelid colour tracks face top — seamless, same material
const LID_FILL_MAP: Record<AppPhase, string> = {
  idle:       '#1e2f42',
  listening:  '#192840',
  thinking:   '#131e32',
  confirming: '#28200e',
  hiring:     '#131e32',
  executing:  '#1e2f42',
  done:       '#132618',
  error:      '#280e0e',
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
              <Stop offset="0"   stopColor={faceTop} stopOpacity="1" />
              <Stop offset="1"   stopColor={faceBot} stopOpacity="1" />
            </LinearGradient>

            {/* Key light — directional top-left specular (3D mass illusion) */}
            <RadialGradient id="keyLight" cx="30%" cy="25%" r="52%">
              <Stop offset="0"   stopColor="rgba(255,255,255,1)" stopOpacity="0.09" />
              <Stop offset="0.6" stopColor="rgba(255,255,255,1)" stopOpacity="0.03" />
              <Stop offset="1"   stopColor="rgba(255,255,255,0)" stopOpacity="0" />
            </RadialGradient>

            {/* Secondary fill — bottom-right rim scatter (bounce light) */}
            <RadialGradient id="rimLight" cx="76%" cy="80%" r="45%">
              <Stop offset="0"   stopColor={glowColor} stopOpacity="0.12" />
              <Stop offset="1"   stopColor={glowColor} stopOpacity="0" />
            </RadialGradient>

            {/* Glow halo — measured, not blown out */}
            <RadialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0"    stopColor={glowColor} stopOpacity="0.52" />
              <Stop offset="0.5"  stopColor={glowColor} stopOpacity="0.18" />
              <Stop offset="1"    stopColor={glowColor} stopOpacity="0" />
            </RadialGradient>

            {/* Sclera — warm white, limbal shadow ring for depth */}
            <RadialGradient id="scleraGrad" cx="46%" cy="40%" r="56%">
              <Stop offset="0"    stopColor="rgba(238,248,255,0.97)" stopOpacity="1" />
              <Stop offset="0.65" stopColor="rgba(200,228,252,0.93)" stopOpacity="1" />
              <Stop offset="1"    stopColor="rgba(152,192,228,0.80)" stopOpacity="1" />
            </RadialGradient>

            {/* Iris — deep blue-grey jewel: 4-stop for genuine depth */}
            <RadialGradient id="irisGrad" cx="40%" cy="36%" r="62%">
              <Stop offset="0"    stopColor="#a8d0f0" stopOpacity="1" />
              <Stop offset="0.25" stopColor="#3a6ea8" stopOpacity="1" />
              <Stop offset="0.68" stopColor="#1a3e70" stopOpacity="1" />
              <Stop offset="1"    stopColor="#0a2040" stopOpacity="1" />
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

            {/* ── Mouth — cubic bezier, soft ice-blue stroke ── */}
            <AnimatedPath
              fill="none"
              stroke="rgba(210,238,255,0.88)"
              strokeWidth={4.2}
              strokeLinecap="round"
              animatedProps={mouthPathProps as any}
            />

            {/* Face border — fine blue-white rim, like polished glass edge */}
            <Ellipse cx={CX} cy={CY} rx={FRX} ry={FRY}
              fill="none" stroke="rgba(168,210,248,0.45)" strokeWidth={1} />
            {/* Inner inset rim — glass depth, barely visible */}
            <Ellipse cx={CX} cy={CY} rx={FRX - 3} ry={FRY - 3}
              fill="none" stroke="rgba(180,220,255,0.10)" strokeWidth={1} />
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
