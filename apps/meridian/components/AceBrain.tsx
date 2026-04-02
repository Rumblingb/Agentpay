import React from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { AppPhase } from '../lib/store';
import { AceFace } from './AceFace';

export type AceBrainMode = 'conversation' | 'onboarding';

type AceFaceSkiaComponent = React.ComponentType<{
  phase: AppPhase;
  isSpeaking: boolean;
  mode?: AceBrainMode;
  micAmplitude?: SharedValue<number>;
  ttsAmplitude?: SharedValue<number>;
  onPress?: () => void;
  disabled?: boolean;
}>;

let AceFaceSkiaImpl: AceFaceSkiaComponent | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  AceFaceSkiaImpl = require('./AceFaceSkia').AceFaceSkia as AceFaceSkiaComponent;
} catch {
  AceFaceSkiaImpl = null;
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

  if (AceFaceSkiaImpl) {
    return (
      <AceFaceSkiaImpl
        phase={phase}
        isSpeaking={isSpeaking}
        mode={mode}
        micAmplitude={micAmplitude ?? silentMic}
        ttsAmplitude={ttsAmplitude ?? silentTts}
        onPress={onPress}
        disabled={disabled}
      />
    );
  }

  return (
    <AceFace
      phase={phase}
      isSpeaking={isSpeaking}
      inputLevel={0}
      outputLevel={0}
      onPress={onPress}
      disabled={disabled}
    />
  );
}
