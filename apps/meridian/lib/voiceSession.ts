import { getVoiceSessionConfig, type VoiceSessionConfig } from './api';

export const DEFAULT_VOICE_SESSION_CONFIG: VoiceSessionConfig = {
  mode: 'batch',
  transport: 'http',
  provider: 'batch_proxy',
  ready: false,
  planningToolsAvailableDuringConversation: true,
  bookingToolsLockedUntilConfirm: true,
  supportsInterruptions: false,
  supportsServerVad: false,
  premiumVoice: 'none',
  fallback: {
    stt: 'whisper_proxy',
    tts: 'none',
  },
  diagnostics: ['session_manifest_unavailable'],
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
