import { useEffect } from 'react';
import { DeviceMotion } from 'expo-sensors';
import { useSharedValue, withTiming } from 'react-native-reanimated';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useAceMotion(enabled = true) {
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);

  useEffect(() => {
    let active = true;
    let subscription: ReturnType<typeof DeviceMotion.addListener> | null = null;

    const reset = () => {
      tiltX.value = withTiming(0, { duration: 180 });
      tiltY.value = withTiming(0, { duration: 180 });
    };

    if (!enabled) {
      reset();
      return;
    }

    (async () => {
      const available = await DeviceMotion.isAvailableAsync().catch(() => false);
      if (!active || !available) {
        reset();
        return;
      }

      DeviceMotion.setUpdateInterval(120);
      subscription = DeviceMotion.addListener((event) => {
        const gravity = event.accelerationIncludingGravity;
        if (!gravity) return;

        const nextX = clamp((gravity.x ?? 0) / 9.80665, -0.85, 0.85);
        const nextY = clamp((gravity.y ?? 0) / 9.80665, -0.85, 0.85);

        tiltX.value = withTiming(nextX, { duration: 140 });
        tiltY.value = withTiming(nextY, { duration: 140 });
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
