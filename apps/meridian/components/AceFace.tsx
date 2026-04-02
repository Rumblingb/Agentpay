/**
 * AceFace - sculptural silver presence for the live Ace conversation surface.
 *
 * Design goals:
 * - Stay entirely within the existing mic footprint
 * - Read as premium, serene, and more "Ace brain" than literal avatar
 * - Let the bust lead, with code only supporting the art direction
 * - Feel like a luminous intelligence rather than a mic, orb, or emoji face
 */

import React, { useEffect } from 'react';
import { Image as RNImage, Pressable, StyleSheet } from 'react-native';
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
const Stop = _svg['Stop'] as React.ComponentType<any>;
const ClipPath = _svg['ClipPath'] as React.ComponentType<any>;
const Circle = _svg['Circle'] as React.ComponentType<any>;
const SvgImage = _svg['Image'] as React.ComponentType<any>;
const Path = _svg['Path'] as React.ComponentType<any>;

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
const RING_R = 116;
const MOUTH_Y = 166;
const MOUTH_HW = 15;

const FACE_PATH =
  'M 135 38 C 181 42 211 87 208 152 C 206 204 185 247 159 266 C 148 274 122 274 111 266 C 85 247 64 204 62 152 C 59 87 89 42 135 38 Z';

const FACE_RENDER_ASSET = RNImage.resolveAssetSource(require('../assets/ace-face-render.png'));

function baseMouthCurveForPhase(phase: AppPhase): number {
  if (phase === 'done') return 3.2;
  if (phase === 'listening') return 0.9;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return -0.4;
  if (phase === 'error') return -1.1;
  return 0.4;
}

function baseMouthOpacityForPhase(phase: AppPhase): number {
  if (phase === 'done') return 0.14;
  if (phase === 'error') return 0.08;
  return 0;
}

function baseTextureOpacityForPhase(phase: AppPhase): number {
  if (phase === 'listening') return 0.86;
  if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') return 0.88;
  if (phase === 'confirming') return 0.78;
  if (phase === 'done') return 0.82;
  if (phase === 'error') return 0.66;
  return 0.78;
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
  const textureOpacity = useSharedValue(baseTextureOpacityForPhase('idle'));
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

  const textureProps = useAnimatedProps(() => ({
    opacity: textureOpacity.value,
  }));

  const mouthProps = useAnimatedProps(() => {
    const curve = mouthCurve.value;
    const x0 = CX - MOUTH_HW;
    const x3 = CX + MOUTH_HW;
    const cp = MOUTH_Y - curve;

    return {
      d: `M ${x0} ${MOUTH_Y} C ${x0 + MOUTH_HW * 0.52} ${cp} ${x3 - MOUTH_HW * 0.52} ${cp} ${x3} ${MOUTH_Y}`,
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
      textureOpacity,
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
    textureOpacity.value = t(baseTextureOpacityForPhase(phase), 240);
    mouthCurve.value = t(baseMouthCurveForPhase(phase), 220);
    mouthOpacity.value = t(baseMouthOpacityForPhase(phase), 220);

    if (phase === 'idle') {
      glowOpacity.value = withRepeat(withSequence(t(0.36, 2600), t(0.18, 2600)), -1, false);
      glowScale.value = withRepeat(withSequence(t(1.08, 2600), t(1, 2600)), -1, false);
      faceLift.value = withRepeat(withSequence(t(-3, 2400), t(0, 2400)), -1, false);
      textureOpacity.value = withRepeat(withSequence(t(0.84, 2400), t(0.72, 2400)), -1, false);
    }

    if (phase === 'listening') {
      glowOpacity.value = t(0.56, 280);
      faceScale.value = withRepeat(withSequence(t(1.026, 1050), t(1, 1050)), -1, false);
      textureOpacity.value = withRepeat(withSequence(t(0.9, 900), t(0.8, 900)), -1, false);
      ring1Opacity.value = withRepeat(withSequence(
        t(0.08, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false);
      ring1Scale.value = withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(1.42, 1800, Easing.out(Easing.quad)),
      ), -1, false);
      ring2Opacity.value = withDelay(900, withRepeat(withSequence(
        t(0.05, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false));
      ring2Scale.value = withDelay(900, withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(1.42, 1800, Easing.out(Easing.quad)),
      ), -1, false));
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      glowOpacity.value = withRepeat(withSequence(t(0.54, 900), t(0.3, 900)), -1, false);
      glowScale.value = withRepeat(withSequence(t(1.1, 900), t(1, 900)), -1, false);
      faceLift.value = withRepeat(withSequence(t(-2, 900), t(0, 900)), -1, false);
      textureOpacity.value = withRepeat(withSequence(t(0.92, 760), t(0.82, 760)), -1, false);
    }

    if (phase === 'confirming') {
      glowOpacity.value = t(0.42, 320);
      textureOpacity.value = t(0.78, 320);
    }

    if (phase === 'done') {
      faceScale.value = withSpring(1.04, { damping: 14, stiffness: 180 });
      faceLift.value = withSpring(-4, { damping: 12, stiffness: 150 });
      glowOpacity.value = t(0.5, 320);
      textureOpacity.value = t(0.82, 320);
    }

    if (phase === 'error') {
      glowOpacity.value = t(0.34, 260);
      textureOpacity.value = t(0.66, 260);
    }
  }, [
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
    textureOpacity,
  ]);

  useEffect(() => {
    [mouthCurve, mouthOpacity].forEach(cancelAnimation);

    if (isSpeaking) {
      mouthCurve.value = withRepeat(withSequence(
        withTiming(2.1, { duration: 120, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.2, { duration: 135, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.7, { duration: 110, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.1, { duration: 140, easing: Easing.inOut(Easing.sin) }),
      ), -1, false);
      mouthOpacity.value = withTiming(0.62, { duration: 120 });
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
          <RadialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={glowColor} stopOpacity="0.56" />
            <Stop offset="0.48" stopColor={glowColor} stopOpacity="0.18" />
            <Stop offset="1" stopColor={glowColor} stopOpacity="0" />
          </RadialGradient>

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
            strokeOpacity={0.44}
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
            strokeOpacity={0.28}
          />
        </AnimatedG>

        <AnimatedG animatedProps={faceProps as any}>
          <Path d={FACE_PATH} fill="rgba(8,16,28,0.92)" />
          <AnimatedG animatedProps={textureProps as any} clipPath="url(#faceClip)">
            <SvgImage
              href={FACE_RENDER_ASSET.uri}
              x={5}
              y={8}
              width={260}
              height={288}
              preserveAspectRatio="xMidYMid meet"
            />
          </AnimatedG>

          <AnimatedPath
            fill="none"
            stroke="rgba(238,248,255,0.7)"
            strokeWidth={1.4}
            strokeLinecap="round"
            animatedProps={mouthProps as any}
          />

          <Path
            d={FACE_PATH}
            fill="none"
            stroke="rgba(200,225,255,0.07)"
            strokeWidth={1}
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
