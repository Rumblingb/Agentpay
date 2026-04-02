/**
 * AceFace - sculptural silver presence for the live Ace conversation surface.
 *
 * Design goals:
 * - Stay entirely within the existing mic footprint
 * - Read as premium, serene, and more "deity" than cartoon
 * - Remove literal eyes and blinking
 * - Feel like a luminous intelligence rather than a generic orb or emoji face
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _svg = require('react-native-svg') as Record<string, React.ComponentType<any>>;
const Svg = _svg['default'] as React.ComponentType<any>;
const Defs = _svg['Defs'] as React.ComponentType<any>;
const RadialGradient = _svg['RadialGradient'] as React.ComponentType<any>;
const LinearGradient = _svg['LinearGradient'] as React.ComponentType<any>;
const Stop = _svg['Stop'] as React.ComponentType<any>;
const ClipPath = _svg['ClipPath'] as React.ComponentType<any>;
const Circle = _svg['Circle'] as React.ComponentType<any>;
const Ellipse = _svg['Ellipse'] as React.ComponentType<any>;
const Path = _svg['Path'] as React.ComponentType<any>;
const G = _svg['G'] as React.ComponentType<any>;

import * as Haptics from 'expo-haptics';
import type { AppPhase } from '../lib/store';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _svgRaw = require('react-native-svg');
const AnimatedG = Animated.createAnimatedComponent(_svgRaw.G) as unknown as React.ComponentType<any>;
const AnimatedPath = Animated.createAnimatedComponent(_svgRaw.Path) as unknown as React.ComponentType<any>;

interface Props {
  phase: AppPhase;
  isSpeaking: boolean;
  onPress?: () => void;
  disabled?: boolean;
}

const CW = 270;
const CH = 310;
const CX = CW / 2;
const CY = CH / 2;
const GLOW_R = 132;
const RING_R = 94;
const MOUTH_Y = 216;
const MOUTH_HW = 23;

const FACE_PATH =
  'M 135 44 C 174 47 205 88 202 148 C 199 205 176 252 135 268 C 94 252 71 205 68 148 C 65 88 96 47 135 44 Z';

const FACE_PATH_INNER =
  'M 135 52 C 168 55 194 92 191 146 C 188 198 168 238 135 251 C 102 238 82 198 79 146 C 76 92 102 55 135 52 Z';

const BROW_PATH = 'M 101 113 C 114 101 156 101 169 113';
const FOREHEAD_CROWN_PATH = 'M 98 96 C 108 71 162 71 172 96';
const NOSE_RIDGE_PATH = 'M 135 93 C 132 128 132 162 135 205';
const CHEEK_LEFT_PATH = 'M 114 126 C 98 150 94 182 105 219';
const CHEEK_RIGHT_PATH = 'M 156 126 C 172 150 176 182 165 219';
const TEMPLE_LEFT_PATH = 'M 103 100 C 90 126 87 160 98 191';
const TEMPLE_RIGHT_PATH = 'M 167 100 C 180 126 183 160 172 191';
const CHIN_PATH = 'M 114 225 C 124 236 146 236 156 225';
const THROAT_LEFT_PATH = 'M 126 204 C 120 225 118 245 121 266';
const THROAT_RIGHT_PATH = 'M 144 204 C 150 225 152 245 149 266';
const CORE_SPINE_PATH = 'M 135 70 C 136 110 136 146 135 186 C 134 212 134 236 135 261';

function baseMouthCurveForPhase(phase: AppPhase): number {
  if (phase === 'done') return 4.2;
  if (phase === 'listening') return 1.1;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return -0.6;
  if (phase === 'error') return -1.6;
  return 0.8;
}

function baseMouthOpacityForPhase(phase: AppPhase): number {
  if (phase === 'listening') return 0.56;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.36;
  if (phase === 'done') return 0.82;
  if (phase === 'error') return 0.48;
  return 0.52;
}

function baseContourOpacityForPhase(phase: AppPhase): number {
  if (phase === 'listening') return 0.76;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.86;
  if (phase === 'confirming') return 0.7;
  if (phase === 'done') return 0.8;
  if (phase === 'error') return 0.54;
  return 0.62;
}

function baseAuraOpacityForPhase(phase: AppPhase): number {
  if (phase === 'listening') return 0.42;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.5;
  if (phase === 'confirming') return 0.34;
  if (phase === 'done') return 0.4;
  if (phase === 'error') return 0.26;
  return 0.3;
}

const GLOW_COLOR: Record<AppPhase, string> = {
  idle: '#eef4ff',
  listening: '#ffffff',
  thinking: '#f3f7ff',
  confirming: '#fff2dc',
  hiring: '#f3f7ff',
  executing: '#f2f7ff',
  done: '#effff5',
  error: '#ffe8ef',
};

const ACCENT_COLOR: Record<AppPhase, string> = {
  idle: '#dbe6f6',
  listening: '#f8fbff',
  thinking: '#e8f0fd',
  confirming: '#f7ead0',
  hiring: '#e8f0fd',
  executing: '#edf3ff',
  done: '#e6f6ea',
  error: '#f7dde4',
};

export function AceFace({ phase, isSpeaking, onPress, disabled }: Props) {
  const faceScale = useSharedValue(1);
  const faceLift = useSharedValue(0);
  const glowOpacity = useSharedValue(0.28);
  const glowScale = useSharedValue(1);
  const ring1Scale = useSharedValue(1);
  const ring1Opacity = useSharedValue(0);
  const ring2Scale = useSharedValue(1);
  const ring2Opacity = useSharedValue(0);
  const auraOpacity = useSharedValue(baseAuraOpacityForPhase('idle'));
  const contourOpacity = useSharedValue(baseContourOpacityForPhase('idle'));
  const mouthCurve = useSharedValue(baseMouthCurveForPhase('idle'));
  const mouthOpacity = useSharedValue(baseMouthOpacityForPhase('idle'));

  const faceProps = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY + faceLift.value}) scale(${faceScale.value}) translate(${-CX} ${-CY})`,
  }));

  const glowProps = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${glowScale.value}) translate(${-CX} ${-CY})`,
    opacity: glowOpacity.value,
  }));

  const ring1Props = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${ring1Scale.value}) translate(${-CX} ${-CY})`,
    opacity: ring1Opacity.value,
  }));

  const ring2Props = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${ring2Scale.value}) translate(${-CX} ${-CY})`,
    opacity: ring2Opacity.value,
  }));

  const auraProps = useAnimatedProps(() => ({
    opacity: auraOpacity.value,
  }));

  const contourProps = useAnimatedProps(() => ({
    opacity: contourOpacity.value,
  }));

  const mouthProps = useAnimatedProps(() => {
    const curve = mouthCurve.value;
    const x0 = CX - MOUTH_HW;
    const x3 = CX + MOUTH_HW;
    const y = MOUTH_Y;
    const cp = y - curve;
    return {
      d: `M ${x0} ${y} C ${x0 + MOUTH_HW * 0.52} ${cp} ${x3 - MOUTH_HW * 0.52} ${cp} ${x3} ${y}`,
      opacity: mouthOpacity.value,
    };
  });

  useEffect(() => {
    [
      faceScale,
      faceLift,
      glowOpacity,
      glowScale,
      ring1Scale,
      ring1Opacity,
      ring2Scale,
      ring2Opacity,
      auraOpacity,
      contourOpacity,
      mouthCurve,
      mouthOpacity,
    ].forEach(cancelAnimation);

    const t = (value: number, duration: number, easing = Easing.inOut(Easing.sin)) =>
      withTiming(value, { duration, easing });

    glowScale.value = t(1, 220);
    glowOpacity.value = t(0.28, 220);
    faceScale.value = t(1, 220);
    faceLift.value = t(0, 220);
    ring1Scale.value = 1;
    ring1Opacity.value = 0;
    ring2Scale.value = 1;
    ring2Opacity.value = 0;
    auraOpacity.value = t(baseAuraOpacityForPhase(phase), 240);
    contourOpacity.value = t(baseContourOpacityForPhase(phase), 240);
    mouthCurve.value = t(baseMouthCurveForPhase(phase), 220);
    mouthOpacity.value = t(baseMouthOpacityForPhase(phase), 220);

    if (phase === 'idle') {
      glowOpacity.value = withRepeat(withSequence(t(0.36, 2600), t(0.18, 2600)), -1, false);
      glowScale.value = withRepeat(withSequence(t(1.08, 2600), t(1, 2600)), -1, false);
      faceLift.value = withRepeat(withSequence(t(-3, 2400), t(0, 2400)), -1, false);
      auraOpacity.value = withRepeat(withSequence(t(0.32, 2400), t(0.22, 2400)), -1, false);
      contourOpacity.value = withRepeat(withSequence(t(0.66, 2400), t(0.56, 2400)), -1, false);
    }

    if (phase === 'listening') {
      glowOpacity.value = t(0.56, 280);
      faceScale.value = withRepeat(withSequence(t(1.026, 1050), t(1, 1050)), -1, false);
      auraOpacity.value = withRepeat(withSequence(t(0.46, 850), t(0.34, 850)), -1, false);
      contourOpacity.value = t(0.78, 280);
      ring1Opacity.value = withRepeat(withSequence(
        t(0.26, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false);
      ring1Scale.value = withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(1.85, 1800, Easing.out(Easing.quad)),
      ), -1, false);
      ring2Opacity.value = withDelay(900, withRepeat(withSequence(
        t(0.22, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false));
      ring2Scale.value = withDelay(900, withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(1.85, 1800, Easing.out(Easing.quad)),
      ), -1, false));
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      glowOpacity.value = withRepeat(withSequence(t(0.54, 900), t(0.30, 900)), -1, false);
      glowScale.value = withRepeat(withSequence(t(1.1, 900), t(1, 900)), -1, false);
      faceLift.value = withRepeat(withSequence(t(-2, 900), t(0, 900)), -1, false);
      auraOpacity.value = withRepeat(withSequence(t(0.56, 760), t(0.34, 760)), -1, false);
      contourOpacity.value = withRepeat(withSequence(t(0.9, 760), t(0.7, 760)), -1, false);
    }

    if (phase === 'confirming') {
      glowOpacity.value = t(0.42, 320);
      contourOpacity.value = t(0.72, 320);
      auraOpacity.value = t(0.36, 320);
    }

    if (phase === 'done') {
      faceScale.value = withSpring(1.04, { damping: 14, stiffness: 180 });
      faceLift.value = withSpring(-4, { damping: 12, stiffness: 150 });
      glowOpacity.value = t(0.5, 320);
      contourOpacity.value = t(0.82, 320);
      auraOpacity.value = t(0.4, 320);
    }

    if (phase === 'error') {
      glowOpacity.value = t(0.34, 260);
      contourOpacity.value = t(0.54, 260);
      auraOpacity.value = t(0.24, 260);
    }
  }, [
    auraOpacity,
    contourOpacity,
    faceLift,
    faceScale,
    glowOpacity,
    glowScale,
    mouthCurve,
    mouthOpacity,
    phase,
    ring1Opacity,
    ring1Scale,
    ring2Opacity,
    ring2Scale,
  ]);

  useEffect(() => {
    [mouthCurve, mouthOpacity].forEach(cancelAnimation);

    if (isSpeaking) {
      mouthCurve.value = withRepeat(withSequence(
        withTiming(4.6, { duration: 130, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.8, { duration: 145, easing: Easing.inOut(Easing.sin) }),
        withTiming(3.8, { duration: 120, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.4, { duration: 150, easing: Easing.inOut(Easing.sin) }),
      ), -1, false);
      mouthOpacity.value = withTiming(0.92, { duration: 180 });
    } else {
      mouthCurve.value = withTiming(baseMouthCurveForPhase(phase), { duration: 220 });
      mouthOpacity.value = withTiming(baseMouthOpacityForPhase(phase), { duration: 200 });
    }

    return () => {
      [mouthCurve, mouthOpacity].forEach(cancelAnimation);
    };
  }, [isSpeaking, mouthCurve, mouthOpacity, phase]);

  const glowColor = GLOW_COLOR[phase] ?? '#eef4ff';
  const accentColor = ACCENT_COLOR[phase] ?? '#dbe6f6';
  const isInteractive = phase !== 'done';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  return (
    <Pressable onPress={handlePress} disabled={disabled || !isInteractive} style={styles.container}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="xMidYMid meet">
        <Defs>
          <LinearGradient id="shellGrad" x1="0.2" y1="0.08" x2="0.82" y2="0.92">
            <Stop offset="0" stopColor="#fbfcff" stopOpacity="0.94" />
            <Stop offset="0.28" stopColor="#e4e7ef" stopOpacity="0.84" />
            <Stop offset="0.7" stopColor="#8d93a1" stopOpacity="0.92" />
            <Stop offset="1" stopColor="#4e5664" stopOpacity="0.98" />
          </LinearGradient>

          <RadialGradient id="keyLight" cx="30%" cy="24%" r="54%">
            <Stop offset="0" stopColor="rgba(255,255,255,1)" stopOpacity="0.34" />
            <Stop offset="0.55" stopColor="rgba(255,255,255,1)" stopOpacity="0.10" />
            <Stop offset="1" stopColor="rgba(255,255,255,0)" stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id="rimLight" cx="78%" cy="82%" r="46%">
            <Stop offset="0" stopColor={glowColor} stopOpacity="0.18" />
            <Stop offset="1" stopColor={glowColor} stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id="innerShadow" cx="53%" cy="76%" r="56%">
            <Stop offset="0" stopColor="rgba(18,24,36,1)" stopOpacity="0.34" />
            <Stop offset="0.56" stopColor="rgba(18,24,36,1)" stopOpacity="0.12" />
            <Stop offset="1" stopColor="rgba(18,24,36,0)" stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={glowColor} stopOpacity="0.56" />
            <Stop offset="0.48" stopColor={glowColor} stopOpacity="0.18" />
            <Stop offset="1" stopColor={glowColor} stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id="coreGrad" cx="50%" cy="34%" r="54%">
            <Stop offset="0" stopColor="rgba(255,255,255,1)" stopOpacity="0.42" />
            <Stop offset="0.42" stopColor="rgba(234,239,248,1)" stopOpacity="0.22" />
            <Stop offset="1" stopColor="rgba(234,239,248,0)" stopOpacity="0" />
          </RadialGradient>

          <LinearGradient id="contourGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor="rgba(255,255,255,0.96)" stopOpacity="0.92" />
            <Stop offset="0.48" stopColor="rgba(231,237,246,0.96)" stopOpacity="0.84" />
            <Stop offset="1" stopColor={accentColor} stopOpacity="0.56" />
          </LinearGradient>

          <ClipPath id="faceClip">
            <Path d={FACE_PATH} />
          </ClipPath>
        </Defs>

        <AnimatedG animatedProps={glowProps as any}>
          <Circle cx={CX} cy={CY} r={GLOW_R} fill="url(#haloGrad)" />
        </AnimatedG>

        <AnimatedG animatedProps={ring1Props as any}>
          <Circle
            cx={CX}
            cy={CY}
            r={RING_R}
            fill="none"
            stroke={accentColor}
            strokeWidth={1.4}
            strokeOpacity={0.86}
          />
        </AnimatedG>
        <AnimatedG animatedProps={ring2Props as any}>
          <Circle
            cx={CX}
            cy={CY}
            r={RING_R}
            fill="none"
            stroke={accentColor}
            strokeWidth={1.1}
            strokeOpacity={0.58}
          />
        </AnimatedG>

        <AnimatedG animatedProps={faceProps as any}>
          <Path d={FACE_PATH} fill="url(#shellGrad)" />
          <Path d={FACE_PATH} fill="url(#keyLight)" clipPath="url(#faceClip)" />
          <Path d={FACE_PATH} fill="url(#rimLight)" clipPath="url(#faceClip)" />
          <Path d={FACE_PATH} fill="url(#innerShadow)" clipPath="url(#faceClip)" />

          <AnimatedG animatedProps={auraProps as any} clipPath="url(#faceClip)">
            <Ellipse cx={CX} cy={CY - 28} rx={46} ry={62} fill="url(#coreGrad)" />
            <Ellipse cx={CX} cy={CY + 20} rx={34} ry={54} fill="url(#coreGrad)" opacity={0.52} />
          </AnimatedG>

          <AnimatedG animatedProps={contourProps as any} clipPath="url(#faceClip)">
            <Path d={FOREHEAD_CROWN_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={1.6} strokeLinecap="round" />
            <Path d={BROW_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={1.35} strokeLinecap="round" />
            <Path d={CORE_SPINE_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={1.55} strokeLinecap="round" />
            <Path d={NOSE_RIDGE_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={1.2} strokeLinecap="round" />
            <Path d={TEMPLE_LEFT_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={0.95} strokeLinecap="round" />
            <Path d={TEMPLE_RIGHT_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={0.95} strokeLinecap="round" />
            <Path d={CHEEK_LEFT_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={1.1} strokeLinecap="round" />
            <Path d={CHEEK_RIGHT_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={1.1} strokeLinecap="round" />
            <Path d={THROAT_LEFT_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={0.95} strokeLinecap="round" />
            <Path d={THROAT_RIGHT_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={0.95} strokeLinecap="round" />
            <Path d={CHIN_PATH} fill="none" stroke="url(#contourGrad)" strokeWidth={1.25} strokeLinecap="round" />
            <Circle cx={CX} cy={95} r={2.2} fill="rgba(255,255,255,0.86)" />
            <Circle cx={CX} cy={178} r={1.6} fill="rgba(247,250,255,0.62)" />
            <Circle cx={CX} cy={236} r={1.8} fill="rgba(247,250,255,0.56)" />
          </AnimatedG>

          <AnimatedPath
            fill="none"
            stroke="rgba(244,248,255,0.92)"
            strokeWidth={3.8}
            strokeLinecap="round"
            animatedProps={mouthProps as any}
          />

          <Path
            d={FACE_PATH}
            fill="none"
            stroke="rgba(250,252,255,0.78)"
            strokeWidth={1.08}
          />
          <Path
            d={FACE_PATH_INNER}
            fill="none"
            stroke="rgba(236,242,250,0.20)"
            strokeWidth={0.95}
          />
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
