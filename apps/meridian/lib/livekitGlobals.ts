import { registerGlobals } from '@livekit/react-native';

let registered = false;

export function ensureLiveKitGlobals(): void {
  if (registered) return;
  registerGlobals();
  registered = true;
}

ensureLiveKitGlobals();
