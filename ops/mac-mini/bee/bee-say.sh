#!/bin/bash
# Bee voice — open-weight neural TTS with graceful fallback. Priority:
#   1. Voicebox + Qwen CustomVoice (natural delivery, local MLX)
#   2. PersonaPlex shim when explicitly configured
#   3. Kokoro (fast local neural fallback)
#   4. macOS `say` (always-there fallback)
# Usage: bee-say.sh <text...>
TEXT="$*"; [ -z "${TEXT// }" ] && exit 0
WAV="$(mktemp -t bee-say).wav"

# 1) Voicebox handles profiles, style control, and model selection behind a local-only API.
VOICEBOX_HELPER="$(cd "$(dirname "$0")" && pwd)/voicebox-say.mjs"
if [ -f "$VOICEBOX_HELPER" ] && node "$VOICEBOX_HELPER" "$TEXT" "$WAV" 2>/dev/null && [ -s "$WAV" ]; then
  afplay "$WAV" 2>/dev/null; rm -f "$WAV"; exit 0
fi

# 2) PersonaPlex neural voice (its local shim should accept {"input": "<text>"} → audio/wav)
PPLEX="${BEE_PERSONAPLEX_URL:-}"
if [ -n "$PPLEX" ]; then
  pp=$(python3 -c 'import json,sys;print(json.dumps({"input":sys.argv[1],"voice":sys.argv[2]}))' "$TEXT" "${BEE_PERSONAPLEX_VOICE:-bee}" 2>/dev/null)
  if curl -fs -m 25 "$PPLEX" -H 'content-type: application/json' -d "$pp" -o "$WAV" 2>/dev/null && [ -s "$WAV" ]; then
    afplay "$WAV" 2>/dev/null; rm -f "$WAV"; exit 0
  fi
fi

# 3) Kokoro (fast open-weight neural fallback)
URL="${BEE_TTS_URL:-http://127.0.0.1:8790/v1/audio/speech}"
MODEL="${BEE_TTS_MODEL:-mlx-community/Kokoro-82M-bf16}"
KVOICE="${BEE_TTS_KOKORO_VOICE:-af_heart}"
payload=$(python3 -c 'import json,sys;print(json.dumps({"model":sys.argv[1],"input":sys.argv[2],"voice":sys.argv[3]}))' "$MODEL" "$TEXT" "$KVOICE" 2>/dev/null)
if [ -n "$payload" ] && curl -fs -m 20 "$URL" -H 'content-type: application/json' -d "$payload" -o "$WAV" 2>/dev/null && [ -s "$WAV" ]; then
  afplay "$WAV" 2>/dev/null
else
  say -v "${BEE_VOICE:-Samantha}" -r "${BEE_RATE:-185}" "$TEXT" 2>/dev/null   # 4) always-there fallback
fi
rm -f "$WAV"
