import { useEffect } from 'react';
import { Accelerometer } from 'expo-sensors';
import { useSharedValue, withTiming } from 'react-native-reanimated';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useAceMotion(enabled = true) {
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);

  useEffect(() => {
    let active = true;
    let subscription: ReturnType<typeof Accelerometer.addListener> | null = null;

    const reset = () => {
      tiltX.value = withTiming(0, { duration: 180 });
      tiltY.value = withTiming(0, { duration: 180 });
    };

    if (!enabled) {
      reset();
      return;
    }

    (async () => {
      const available = await Accelerometer.isAvailableAsync().catch(() => false);
      if (!active || !available) {
        reset();
        return;
      }

      Accelerometer.setUpdateInterval(60);
      subscription = Accelerometer.addListener((event) => {
        const nextX = clamp(event.x ?? 0, -0.85, 0.85);
        const nextY = clamp(event.y ?? 0, -0.85, 0.85);

        tiltX.value = withTiming(nextX, { duration: 110 });
        tiltY.value = withTiming(nextY, { duration: 110 });
      });
    })();

    return () => {
      active = false;
      subscription?.remove();
      reset();
    };
  }, [enabled, tiltX, tiltY]);

  return { tiltX, tiltY };
}
