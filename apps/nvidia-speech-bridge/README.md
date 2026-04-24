# NVIDIA Speech Bridge

This internal bridge lets Ace keep using the existing `/api/voice/*` routes while routing speech through NVIDIA Speech NIM.

Why the bridge exists:

- Ace records AAC/M4A on mobile.
- NVIDIA Speech NIM expects WAV, OPUS, or FLAC on the HTTP ASR path.
- The bridge handles the audio conversion step, then forwards the request to the official NVIDIA speech HTTP endpoints.

## What it does

- `POST /transcribe`
  - accepts base64 audio from the AgentPay Worker
  - converts it to mono 16-bit WAV with `ffmpeg`
  - calls NVIDIA ASR NIM at `/v1/audio/transcriptions`

- `POST /tts`
  - accepts text from the AgentPay Worker
  - calls NVIDIA TTS NIM at `/v1/audio/synthesize`
  - returns the audio bytes back to the Worker

## Required env

See [.env.example](C:/Users/visha/agentpay-host-native-restore/apps/nvidia-speech-bridge/.env.example).

The important values are:

- `NVIDIA_SPEECH_BRIDGE_TOKEN`
- `NVIDIA_ASR_BASE_URL`
- `NVIDIA_TTS_BASE_URL`
- `FFMPEG_PATH` if `ffmpeg` is not already on your PATH

## Local run

```bash
npm run nvidia-speech-bridge:dev
```

Then point Worker local env at:

- `ACE_STT_PROVIDER="nvidia"`
- `ACE_TTS_PROVIDER="nvidia"`
- `NVIDIA_SPEECH_BRIDGE_URL="http://127.0.0.1:8788"`
- `NVIDIA_SPEECH_BRIDGE_TOKEN="<same token>"`

## Product note

The Ace brain can use hosted NVIDIA chat directly through `NVIDIA_API_KEY`.
Speech is separate: it needs NVIDIA Speech NIM HTTP surfaces, so this bridge keeps the AgentPay/Ace runtime seam clean while handling the format conversion NVIDIA ASR requires.
