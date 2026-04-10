import { getVoiceSessionConfig, type VoiceSessionConfig } from './api';

export const DEFAULT_VOICE_SESSION_CONFIG: VoiceSessionConfig = {
  mode: 'batch',
  transport: 'http',
  provider: 'batch_proxy',
  ready: true,
  planningToolsAvailableDuringConversation: true,
  bookingToolsLockedUntilConfirm: true,
  supportsInterruptions: false,
  supportsServerVad: false,
  premiumVoice: 'elevenlabs',
  fallback: {
    stt: 'whisper_proxy',
    tts: 'elevenlabs_http',
  },
  diagnostics: ['session_manifest_unavailable_batch_retained'],
};

let cachedVoiceSessionConfig: VoiceSessionConfig | null = null;

export async function loadVoiceSessionConfig(forceRefresh = false): Promise<VoiceSessionConfig> {
  if (!forceRefresh && cachedVoiceSessionConfig) {
    return cachedVoiceSessionConfig;
  }

  try {
    cachedVoiceSessionConfig = await getVoiceSessionConfig();
    return cachedVoiceSessionConfig;
  } catch {
    cachedVoiceSessionConfig = DEFAULT_VOICE_SESSION_CONFIG;
    return cachedVoiceSessionConfig;
  }
}

export function getCachedVoiceSessionConfig(): VoiceSessionConfig {
  return cachedVoiceSessionConfig ?? DEFAULT_VOICE_SESSION_CONFIG;
}

export function isLiveVoiceSession(config: VoiceSessionConfig): boolean {
  return config.mode === 'live' && config.ready;
}
