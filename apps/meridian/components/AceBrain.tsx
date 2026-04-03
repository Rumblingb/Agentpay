import React from 'react';
import Constants from 'expo-constants';
import { Platform, UIManager } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { AppPhase } from '../lib/store';
import { AceFace } from './AceFace';

export type AceBrainMode = 'conversation' | 'onboarding';
const MIN_ACE_3D_NATIVE_BUILD = 10;

type AceFaceRuntimeComponent = React.ComponentType<{
  phase: AppPhase;
  isSpeaking: boolean;
  mode?: AceBrainMode;
  micAmplitude?: SharedValue<number>;
  ttsAmplitude?: SharedValue<number>;
  onPress?: () => void;
  disabled?: boolean;
}>;

let AceFaceSkiaImpl: AceFaceRuntimeComponent | null = null;
let AceFace3DImpl: AceFaceRuntimeComponent | null | undefined;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AceFaceSkiaImpl = require('./AceFaceSkia').AceFaceSkia as AceFaceRuntimeComponent;
} catch {
  AceFaceSkiaImpl = null;
}

function getNativeBuildNumber(): number | null {
  const rawBuild = Constants.nativeBuildVersion ?? '';
  const parsedBuild = Number.parseInt(rawBuild, 10);
  return Number.isFinite(parsedBuild) ? parsedBuild : null;
}

function hasGLViewSupport(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }

  const nativeBuild = getNativeBuildNumber();
  if (nativeBuild === null || nativeBuild < MIN_ACE_3D_NATIVE_BUILD) {
    return false;
  }

  return UIManager.getViewManagerConfig?.('ExponentGLView') != null;
}

function getAceFace3DImpl(): AceFaceRuntimeComponent | null {
  if (!hasGLViewSupport()) {
    return null;
  }

  if (AceFace3DImpl !== undefined) {
    return AceFace3DImpl;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AceFace3DImpl = require('./AceFace3D').AceFace3D as AceFaceRuntimeComponent;
  } catch {
    AceFace3DImpl = null;
  }

  return AceFace3DImpl;
}

function shouldUse3D(mode: AceBrainMode, aceFace3DImpl: AceFaceRuntimeComponent | null): boolean {
  return mode === 'conversation' && aceFace3DImpl !== null;
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
  const AceFace3DRuntime = getAceFace3DImpl();
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

  if (shouldUse3D(mode, AceFace3DRuntime) && AceFace3DRuntime) {
    return (
      <RuntimeFallbackBoundary fallback={fallbackFace}>
        <AceFace3DRuntime {...runtimeProps} />
      </RuntimeFallbackBoundary>
    );
  }

  return fallbackFace;
}
