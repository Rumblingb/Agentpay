/**
 * AceFace - temporary Path 2 presence.
 *
 * This is intentionally not a humanoid face. The Ace sigil is the object,
 * and the surrounding field responds to real mic / TTS energy so Ace feels
 * attentive, reactive, and alive.
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
const Circle = _svg['Circle'] as React.ComponentType<any>;
const Ellipse = _svg['Ellipse'] as React.ComponentType<any>;
const SvgImage = _svg['Image'] as React.ComponentType<any>;

import * as Haptics from 'expo-haptics';
import type { AppPhase } from '../lib/store';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _svgRaw = require('react-native-svg');
const AnimatedG = Animated.createAnimatedComponent(_svgRaw.G) as unknown as React.ComponentType<any>;

interface Props {
  phase: AppPhase;
  isSpeaking: boolean;
  inputLevel?: number;
  outputLevel?: number;
  onPress?: () => void;
  disabled?: boolean;
}

const MARK_ASSET = RNImage.resolveAssetSource(require('../assets/ace-mark.png'));

const CW = 270;
const CH = 310;
const CX = CW / 2;
const CY = CH / 2 + 8;
const GLOW_R = 132;
const RING_R = 116;

const GLOW_COLOR: Record<AppPhase, string> = {
  idle: '#dfeeff',
  listening: '#f7fbff',
  thinking: '#cfe5ff',
  confirming: '#f4e7ca',
  hiring: '#cfe5ff',
  executing: '#d8ecff',
  done: '#dcf5e3',
  error: '#f5dce2',
};

const CORE_COLOR: Record<AppPhase, string> = {
  idle: '#b8d6ff',
  listening: '#e9f4ff',
  thinking: '#9fcfff',
  confirming: '#f1d6a6',
  hiring: '#9fcfff',
  executing: '#b7d9ff',
  done: '#cdecd4',
  error: '#f0c0c9',
};

const ORBIT_COLOR: Record<AppPhase, string> = {
  idle: '#9fb9d9',
  listening: '#c8e7ff',
  thinking: '#8abce8',
  confirming: '#d8bc8f',
  hiring: '#8abce8',
  executing: '#9fc7eb',
  done: '#9ed0aa',
  error: '#dba0ab',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function AceFace({
  phase,
  isSpeaking,
  inputLevel = 0,
  outputLevel = 0,
  onPress,
  disabled,
}: Props) {
  const liveLevel = phase === 'listening'
    ? inputLevel
    : isSpeaking
    ? outputLevel
    : 0;

  const fieldScale = useSharedValue(1);
  const fieldLift = useSharedValue(0);
  const haloOpacity = useSharedValue(0.22);
  const haloScale = useSharedValue(1);
  const coreOpacity = useSharedValue(0.26);
  const orbitOpacity = useSharedValue(0.08);
  const markScale = useSharedValue(1);
  const markOpacity = useSharedValue(0.96);
  const ring1Scale = useSharedValue(1);
  const ring1Opacity = useSharedValue(0);
  const ring2Scale = useSharedValue(1);
  const ring2Opacity = useSharedValue(0);
  const reactiveLevel = useSharedValue(0);
  const speakingBoost = useSharedValue(0);

  const haloProps = useAnimatedProps(() => {
    const reactiveBoost = reactiveLevel.value * 0.16 + speakingBoost.value * 0.08;
    return {
      transform: `translate(${CX} ${CY}) scale(${haloScale.value + reactiveBoost}) translate(${-CX} ${-CY})`,
      opacity: clamp01(haloOpacity.value + reactiveLevel.value * 0.22 + speakingBoost.value * 0.1),
    };
  });

  const fieldProps = useAnimatedProps(() => {
    const reactiveScale = reactiveLevel.value * 0.1 + speakingBoost.value * 0.04;
    return {
      transform: `translate(${CX} ${CY + fieldLift.value}) scale(${fieldScale.value + reactiveScale}) translate(${-CX} ${-CY})`,
      opacity: 1,
    };
  });

  const coreProps = useAnimatedProps(() => {
    const reactiveScale = 1 + reactiveLevel.value * 0.14 + speakingBoost.value * 0.06;
    return {
      transform: `translate(${CX} ${CY}) scale(${reactiveScale}) translate(${-CX} ${-CY})`,
      opacity: clamp01(coreOpacity.value + reactiveLevel.value * 0.36 + speakingBoost.value * 0.12),
    };
  });

  const orbitProps = useAnimatedProps(() => ({
    opacity: clamp01(orbitOpacity.value + reactiveLevel.value * 0.14),
  }));

  const markProps = useAnimatedProps(() => {
    const reactiveScale = reactiveLevel.value * 0.06 + speakingBoost.value * 0.03;
    return {
      transform: `translate(${CX} ${CY}) scale(${markScale.value + reactiveScale}) translate(${-CX} ${-CY})`,
      opacity: clamp01(markOpacity.value + reactiveLevel.value * 0.08),
    };
  });

  const ring1Props = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${ring1Scale.value}) translate(${-CX} ${-CY})`,
    opacity: ring1Opacity.value,
  }));

  const ring2Props = useAnimatedProps(() => ({
    transform: `translate(${CX} ${CY}) scale(${ring2Scale.value}) translate(${-CX} ${-CY})`,
    opacity: ring2Opacity.value,
  }));

  useEffect(() => {
    reactiveLevel.value = withTiming(clamp01(liveLevel), {
      duration: 90,
      easing: Easing.out(Easing.quad),
    });
  }, [liveLevel, reactiveLevel]);

  useEffect(() => {
    speakingBoost.value = withTiming(isSpeaking ? 0.18 : 0, {
      duration: isSpeaking ? 120 : 180,
      easing: Easing.inOut(Easing.quad),
    });
  }, [isSpeaking, speakingBoost]);

  useEffect(() => {
    [
      fieldScale,
      fieldLift,
      haloOpacity,
      haloScale,
      coreOpacity,
      orbitOpacity,
      markScale,
      markOpacity,
      ring1Scale,
      ring1Opacity,
      ring2Scale,
      ring2Opacity,
    ].forEach(cancelAnimation);

    const t = (value: number, duration: number, easing = Easing.inOut(Easing.sin)) =>
      withTiming(value, { duration, easing });

    fieldScale.value = t(1, 220);
    fieldLift.value = t(0, 220);
    haloOpacity.value = t(0.22, 220);
    haloScale.value = t(1, 220);
    coreOpacity.value = t(0.26, 220);
    orbitOpacity.value = t(0.08, 220);
    markScale.value = t(1, 220);
    markOpacity.value = t(0.96, 220);
    ring1Scale.value = 1;
    ring1Opacity.value = 0;
    ring2Scale.value = 1;
    ring2Opacity.value = 0;

    if (phase === 'idle') {
      haloOpacity.value = withRepeat(withSequence(t(0.3, 2600), t(0.18, 2600)), -1, false);
      haloScale.value = withRepeat(withSequence(t(1.06, 2600), t(1, 2600)), -1, false);
      fieldScale.value = withRepeat(withSequence(t(1.03, 2400), t(1, 2400)), -1, false);
      fieldLift.value = withRepeat(withSequence(t(-2, 2400), t(0, 2400)), -1, false);
      coreOpacity.value = withRepeat(withSequence(t(0.32, 2400), t(0.22, 2400)), -1, false);
      orbitOpacity.value = withRepeat(withSequence(t(0.12, 2400), t(0.06, 2400)), -1, false);
      markScale.value = withRepeat(withSequence(t(1.012, 2400), t(1, 2400)), -1, false);
    }

    if (phase === 'listening') {
      haloOpacity.value = t(0.42, 260);
      coreOpacity.value = withRepeat(withSequence(t(0.5, 920), t(0.34, 920)), -1, false);
      fieldScale.value = withRepeat(withSequence(t(1.04, 1100), t(1.01, 1100)), -1, false);
      markScale.value = withRepeat(withSequence(t(1.02, 1100), t(1, 1100)), -1, false);
      orbitOpacity.value = t(0.14, 240);

      ring1Opacity.value = withRepeat(withSequence(
        t(0.1, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false);
      ring1Scale.value = withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(1.38, 1800, Easing.out(Easing.quad)),
      ), -1, false);
      ring2Opacity.value = withDelay(900, withRepeat(withSequence(
        t(0.06, 1, Easing.linear),
        t(0, 1800, Easing.in(Easing.quad)),
      ), -1, false));
      ring2Scale.value = withDelay(900, withRepeat(withSequence(
        t(1, 1, Easing.linear),
        t(1.38, 1800, Easing.out(Easing.quad)),
      ), -1, false));
    }

    if (phase === 'thinking' || phase === 'hiring' || phase === 'executing') {
      haloOpacity.value = withRepeat(withSequence(t(0.44, 900), t(0.24, 900)), -1, false);
      haloScale.value = withRepeat(withSequence(t(1.08, 900), t(1.01, 900)), -1, false);
      fieldScale.value = withRepeat(withSequence(t(1.05, 900), t(1.01, 900)), -1, false);
      fieldLift.value = withRepeat(withSequence(t(-3, 900), t(0, 900)), -1, false);
      coreOpacity.value = withRepeat(withSequence(t(0.58, 820), t(0.34, 820)), -1, false);
      orbitOpacity.value = withRepeat(withSequence(t(0.2, 820), t(0.1, 820)), -1, false);
      markScale.value = withRepeat(withSequence(t(1.016, 900), t(1, 900)), -1, false);
    }

    if (phase === 'confirming') {
      haloOpacity.value = t(0.3, 280);
      fieldScale.value = t(1.02, 280);
      coreOpacity.value = t(0.36, 280);
      orbitOpacity.value = t(0.1, 280);
      markOpacity.value = t(0.98, 280);
    }

    if (phase === 'done') {
      fieldScale.value = withSpring(1.06, { damping: 14, stiffness: 180 });
      fieldLift.value = withSpring(-4, { damping: 12, stiffness: 150 });
      haloOpacity.value = t(0.34, 320);
      coreOpacity.value = t(0.42, 320);
      orbitOpacity.value = t(0.12, 320);
      markScale.value = withSpring(1.03, { damping: 14, stiffness: 180 });
    }

    if (phase === 'error') {
      haloOpacity.value = t(0.18, 260);
      coreOpacity.value = t(0.2, 260);
      orbitOpacity.value = t(0.04, 260);
      markOpacity.value = t(0.92, 260);
    }
  }, [
    coreOpacity,
    fieldLift,
    fieldScale,
    haloOpacity,
    haloScale,
    markOpacity,
    markScale,
    orbitOpacity,
    phase,
    ring1Opacity,
    ring1Scale,
    ring2Opacity,
    ring2Scale,
  ]);

  const glowColor = GLOW_COLOR[phase] ?? '#dfeeff';
  const coreColor = CORE_COLOR[phase] ?? '#b8d6ff';
  const orbitColor = ORBIT_COLOR[phase] ?? '#9fb9d9';
  const isInteractive = phase !== 'done';

  const handlePress = () => {
    if (disabled || !isInteractive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  return (
    <Pressable onPress={handlePress} disabled={disabled || !isInteractive} style={styles.container}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="xMidYMid meet" overflow="visible">
        <Defs>
          <RadialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={glowColor} stopOpacity="0.56" />
            <Stop offset="0.5" stopColor={glowColor} stopOpacity="0.18" />
            <Stop offset="1" stopColor={glowColor} stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id="fieldGrad" cx="50%" cy="38%" r="62%">
            <Stop offset="0" stopColor="rgba(31, 52, 82, 0.92)" stopOpacity="0.88" />
            <Stop offset="0.46" stopColor="rgba(18, 28, 46, 0.72)" stopOpacity="0.56" />
            <Stop offset="1" stopColor="rgba(8, 14, 24, 0)" stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id="coreGrad" cx="50%" cy="42%" r="54%">
            <Stop offset="0" stopColor={coreColor} stopOpacity="0.72" />
            <Stop offset="0.48" stopColor={coreColor} stopOpacity="0.24" />
            <Stop offset="1" stopColor={coreColor} stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id="streamGrad" cx="50%" cy="30%" r="74%">
            <Stop offset="0" stopColor="rgba(226, 242, 255, 0.92)" stopOpacity="0.18" />
            <Stop offset="0.42" stopColor={glowColor} stopOpacity="0.12" />
            <Stop offset="1" stopColor={glowColor} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <AnimatedG animatedProps={haloProps as any}>
          <Circle cx={CX} cy={CY} r={GLOW_R} fill="url(#haloGrad)" />
        </AnimatedG>

        <AnimatedG animatedProps={ring1Props as any}>
          <Circle
            cx={CX}
            cy={CY}
            r={RING_R}
            fill="none"
            stroke={orbitColor}
            strokeWidth={1.4}
            strokeOpacity={0.4}
          />
        </AnimatedG>
        <AnimatedG animatedProps={ring2Props as any}>
          <Circle
            cx={CX}
            cy={CY}
            r={RING_R}
            fill="none"
            stroke={orbitColor}
            strokeWidth={1}
            strokeOpacity={0.24}
          />
        </AnimatedG>

        <AnimatedG animatedProps={fieldProps as any}>
          <Ellipse cx={CX} cy={CY + 8} rx={86} ry={112} fill="rgba(8,16,28,0.2)" />
          <Ellipse cx={CX} cy={CY + 2} rx={84} ry={108} fill="url(#fieldGrad)" />
          <AnimatedG animatedProps={orbitProps as any}>
            <Ellipse
              cx={CX}
              cy={CY + 4}
              rx={74}
              ry={100}
              fill="none"
              stroke={orbitColor}
              strokeWidth={1}
              strokeOpacity={0.3}
              rotation="-18"
              originX={CX}
              originY={CY}
            />
            <Ellipse
              cx={CX}
              cy={CY + 6}
              rx={66}
              ry={92}
              fill="none"
              stroke={orbitColor}
              strokeWidth={0.8}
              strokeOpacity={0.2}
              rotation="20"
              originX={CX}
              originY={CY}
            />
          </AnimatedG>
          <AnimatedG animatedProps={coreProps as any}>
            <Ellipse cx={CX} cy={CY - 10} rx={52} ry={72} fill="url(#coreGrad)" />
            <Ellipse cx={CX - 24} cy={CY + 18} rx={26} ry={54} fill="url(#streamGrad)" />
            <Ellipse cx={CX + 24} cy={CY + 18} rx={26} ry={54} fill="url(#streamGrad)" />
            <Ellipse cx={CX} cy={CY + 42} rx={34} ry={48} fill="url(#streamGrad)" opacity={0.82} />
          </AnimatedG>
          <AnimatedG animatedProps={markProps as any}>
            <SvgImage
              href={MARK_ASSET.uri}
              x={81}
              y={78}
              width={108}
              height={142}
              preserveAspectRatio="xMidYMid meet"
            />
          </AnimatedG>
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
