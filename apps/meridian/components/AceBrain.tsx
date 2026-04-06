import React from 'react';
import Constants from 'expo-constants';
import { Platform, UIManager } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { AppPhase } from '../lib/store';
import { AceFace } from './AceFace';
import { trackClientEvent } from '../lib/telemetry';

export type AceBrainMode = 'conversation' | 'onboarding';

// ─── Feature flag ─────────────────────────────────────────────────────────────
//
// ACE_3D_RUNTIME_ENABLED: master switch for the @react-three/fiber 3D runtime.
//
// Enabled on iOS builds >= MIN_ACE_3D_NATIVE_BUILD when ExponentGLView is
// present. Disabled on Android (GLView stability) and web.
//
// Crash telemetry: RuntimeFallbackBoundary reports to trackClientEvent so we
// can monitor 3D render failures in production without surfacing them to users.
// Set to false to force Skia path on all builds.
//
const ACE_3D_RUNTIME_ENABLED =
  Platform.OS === 'ios' &&
  process.env.EXPO_PUBLIC_ACE_3D_ENABLED !== 'false';

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

function hasGLViewSupport(mode: AceBrainMode): boolean {
  if (!ACE_3D_RUNTIME_ENABLED || mode !== 'conversation' || Platform.OS === 'web') {
    return false;
  }

  const nativeBuild = getNativeBuildNumber();
  if (nativeBuild === null || nativeBuild < MIN_ACE_3D_NATIVE_BUILD) {
    return false;
  }

  return UIManager.getViewManagerConfig?.('ExponentGLView') != null;
}

function getAceFace3DImpl(mode: AceBrainMode): AceFaceRuntimeComponent | null {
  if (!hasGLViewSupport(mode)) {
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

// ─── Crash boundary with telemetry ───────────────────────────────────────────

interface RuntimeFallbackBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
  runtime: '3d' | 'skia';
}

interface RuntimeFallbackBoundaryState {
  hasError: boolean;
}

class RuntimeFallbackBoundary extends React.Component<
  RuntimeFallbackBoundaryProps,
  RuntimeFallbackBoundaryState
> {
  state: RuntimeFallbackBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RuntimeFallbackBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Report crash so we can monitor 3D / Skia failures per build in telemetry
    void trackClientEvent({
      event: 'ace_face_runtime_crash',
      screen: 'ace_brain',
      severity: 'warning',
      message: error?.message ?? 'AceFace runtime crashed',
      metadata: {
        runtime: this.props.runtime,
        platform: Platform.OS,
        buildNumber: Constants.nativeBuildVersion ?? null,
        errorName: error?.name ?? null,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ─── AceBrain ────────────────────────────────────────────────────────────────

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
  const AceFace3DRuntime = getAceFace3DImpl(mode);

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

  // Skia is the primary runtime — legacy SVG face is the last resort fallback
  const skiaFace = AceFaceSkiaImpl ? (
    <RuntimeFallbackBoundary fallback={legacyFace} runtime="skia">
      <AceFaceSkiaImpl {...runtimeProps} />
    </RuntimeFallbackBoundary>
  ) : legacyFace;

  // 3D is the premium runtime — falls back to Skia on crash or unavailability
  if (shouldUse3D(mode, AceFace3DRuntime) && AceFace3DRuntime) {
    return (
      <RuntimeFallbackBoundary fallback={skiaFace} runtime="3d">
        <AceFace3DRuntime {...runtimeProps} />
      </RuntimeFallbackBoundary>
    );
  }

  return skiaFace;
}
