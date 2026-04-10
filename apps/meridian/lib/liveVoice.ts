import { AudioSession } from '@livekit/react-native';
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import {
  ConnectionState,
  Room,
  RoomEvent,
  type ChatMessage,
  type Participant,
  type RoomConnectOptions,
  type TranscriptionSegment,
} from 'livekit-client';
import { createLiveVoiceSession } from './api';

async function prepareLiveVoiceAudio(): Promise<void> {
  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) {
    throw new Error('Microphone permission denied.');
  }

  if (Platform.OS === 'android') {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
    } catch {
      // Non-fatal. LiveKit will still attempt to claim the communication route.
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 80));
  }
}

async function releaseLiveVoiceAudio(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });
  } catch {
    // Ignore teardown errors. The next voice path will reset the route again.
  }
}

export type LiveVoiceCallbacks = {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onConnectionStateChanged?: (state: ConnectionState) => void;
  onRemoteSpeakingChanged?: (speaking: boolean) => void;
  onParticipantConnected?: (participant: Participant) => void;
  onParticipantDisconnected?: (participant: Participant) => void;
  onChatMessage?: (message: ChatMessage, participant?: Participant) => void;
  onTranscriptionReceived?: (segments: TranscriptionSegment[], participant?: Participant) => void;
  onError?: (error: Error) => void;
};

export type LiveVoiceConnection = {
  room: Room;
  roomName: string;
  participantIdentity: string;
  disconnect: () => Promise<void>;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
};

export async function connectLiveVoiceSession(params: {
  hirerId: string;
  sessionId: string;
  callbacks?: LiveVoiceCallbacks;
}): Promise<LiveVoiceConnection> {
  const credentials = await createLiveVoiceSession({
    hirerId: params.hirerId,
    sessionId: params.sessionId,
  });

  const room = new Room({
    adaptiveStream: false,
    dynacast: false,
    stopLocalTrackOnUnpublish: true,
  });

  const callbacks = params.callbacks;
  const emitRemoteSpeaking = () => {
    const remoteSpeaking = room.activeSpeakers.some((participant) => participant.identity !== room.localParticipant.identity);
    callbacks?.onRemoteSpeakingChanged?.(remoteSpeaking);
  };

  room
    .on(RoomEvent.Connected, () => {
      callbacks?.onConnected?.();
      emitRemoteSpeaking();
    })
    .on(RoomEvent.Disconnected, () => {
      callbacks?.onDisconnected?.();
      callbacks?.onRemoteSpeakingChanged?.(false);
    })
    .on(RoomEvent.Reconnecting, () => {
      callbacks?.onReconnecting?.();
    })
    .on(RoomEvent.Reconnected, () => {
      callbacks?.onReconnected?.();
      emitRemoteSpeaking();
    })
    .on(RoomEvent.ConnectionStateChanged, (state) => {
      callbacks?.onConnectionStateChanged?.(state);
    })
    .on(RoomEvent.ActiveSpeakersChanged, () => {
      emitRemoteSpeaking();
    })
    .on(RoomEvent.ParticipantConnected, (participant) => {
      callbacks?.onParticipantConnected?.(participant);
    })
    .on(RoomEvent.ParticipantDisconnected, (participant) => {
      callbacks?.onParticipantDisconnected?.(participant);
      emitRemoteSpeaking();
    })
    .on(RoomEvent.ChatMessage, (message, participant) => {
      callbacks?.onChatMessage?.(message, participant);
    })
    .on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      callbacks?.onTranscriptionReceived?.(segments, participant);
    });

  try {
    await prepareLiveVoiceAudio();
    await AudioSession.startAudioSession();
    room.prepareConnection(credentials.serverUrl, credentials.participantToken);
    const connectOptions: RoomConnectOptions = {
      autoSubscribe: true,
    };
    await room.connect(credentials.serverUrl, credentials.participantToken, connectOptions);
    await room.localParticipant.setMicrophoneEnabled(true, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  } catch (error: any) {
    callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)));
    try {
      await room.disconnect();
    } catch {}
    await AudioSession.stopAudioSession().catch(() => {});
    await releaseLiveVoiceAudio();
    throw error;
  }

  return {
    room,
    roomName: credentials.roomName,
    participantIdentity: credentials.participantIdentity,
    disconnect: async () => {
      callbacks?.onRemoteSpeakingChanged?.(false);
      try {
        await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        await room.disconnect();
      } finally {
        await AudioSession.stopAudioSession().catch(() => {});
        await releaseLiveVoiceAudio();
      }
    },
    setMicrophoneEnabled: async (enabled: boolean) => {
      await room.localParticipant.setMicrophoneEnabled(enabled, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    },
  };
}
