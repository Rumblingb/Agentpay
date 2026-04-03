import React from 'react';
import { Platform } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { AppPhase } from '../lib/store';
import { AceFace } from './AceFace';

export type AceBrainMode = 'conversation' | 'onboarding';

type AceFaceRuntimeComponent = React.ComponentType<{
  phase: AppPhase;
  isSpeaking: boolean;
  mode?: AceBrainMode;
  micAmplitude?: SharedValue<number>;
  ttsAmplitude?: SharedValue<number>;
  onPress?: () => void;
  disabled?: boolean;
}>;

let AceFace3DImpl: AceFaceRuntimeComponent | null = null;
let AceFaceSkiaImpl: AceFaceRuntimeComponent | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AceFace3DImpl = require('./AceFace3D').AceFace3D as AceFaceRuntimeComponent;
} catch {
  AceFace3DImpl = null;
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AceFaceSkiaImpl = require('./AceFaceSkia').AceFaceSkia as AceFaceRuntimeComponent;
} catch {
  AceFaceSkiaImpl = null;
}

function shouldUse3D(mode: AceBrainMode): boolean {
  return mode === 'conversation' && Platform.OS !== 'web' && AceFace3DImpl !== null;
}

interface RuntimeFallbackBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface RuntimeFallbackBoundaryState {
  hasError: boolean;
}

class RuntimeFallbackBoundary extends React.Component<
  RuntimeFallbackBoundaryProps,
  RuntimeFallbackBoundaryState
> {
  state: RuntimeFallbackBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): RuntimeFallbackBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {}

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

interface Props {
  phase: AppPhase;
  isSpeaking?: boolean;
  mode?: AceBrainMode;
  micAmplitude?: SharedValue<number>;
  ttsAmplitude?: SharedValue<number>;
  onPress?: () => void;
  disabled?: boolean;
}

export function AceBrain({
  phase,
  isSpeaking = false,
  mode = 'conversation',
  micAmplitude,
  ttsAmplitude,
  onPress,
  disabled,
}: Props) {
  const silentMic = useSharedValue(0);
  const silentTts = useSharedValue(0);
  const legacyFace = (
    <AceFace
      phase={phase}
      isSpeaking={isSpeaking}
      inputLevel={0}
      outputLevel={0}
      onPress={onPress}
      disabled={disabled}
    />
  );
  const runtimeProps = {
    phase,
    isSpeaking,
    mode,
    micAmplitude: micAmplitude ?? silentMic,
    ttsAmplitude: ttsAmplitude ?? silentTts,
    onPress,
    disabled,
  };
  const fallbackFace = AceFaceSkiaImpl ? <AceFaceSkiaImpl {...runtimeProps} /> : legacyFace;

  if (shouldUse3D(mode) && AceFace3DImpl) {
    return (
      <RuntimeFallbackBoundary fallback={fallbackFace}>
        <AceFace3DImpl {...runtimeProps} />
      </RuntimeFallbackBoundary>
    );
  }

  return fallbackFace;
}
