/**
 * biometric.ts — Face ID / fingerprint authentication wrapper
 *
 * Wraps expo-local-authentication with graceful fallback.
 * Used as a gate before reading or writing the travel profile.
 */

import * as LocalAuthentication from 'expo-local-authentication';

export async function isBiometricAvailable(): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hardware && enrolled;
}

/**
 * Prompt biometric authentication. Returns true on success.
 * Falls back gracefully if biometrics are unavailable (returns true — device lacks support).
 */
export async function authenticateWithBiometrics(reason: string): Promise<boolean> {
  const available = await isBiometricAvailable();
  if (!available) {
    // No biometric hardware or not enrolled — pass through.
    // In production you'd enforce device PIN here.
    return true;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use Passcode',
    disableDeviceFallback: false,
  });

  return result.success;
}

/** Returns the best available biometric type name for display */
export async function getBiometricLabel(): Promise<string> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return 'Face ID';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return 'Fingerprint';
  }
  return 'Biometric';
}
