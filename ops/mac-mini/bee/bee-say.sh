#!/bin/bash
# Bee voice — ONE natural voice, no double-play. Priority:
#   1. VibeVoice — ONLY when BEE_VIBEVOICE_URL or BEE_USE_VIBEVOICE=1 is set (best remote/Lenovo path).
#   2. Kokoro (mlx-audio server :8790) — local neural, returns a WAV, single afplay. DEFAULT (natural + reliable).
#   3. Voicebox — ONLY if BEE_USE_VOICEBOX=1 (heavy/slow; useful for voice-profile experiments).
#   4. PersonaPlex — if BEE_PERSONAPLEX_URL is set.
#   5. macOS `say` — last resort (robotic; only if every neural path is down).
# Usage: bee-say.sh <text...>
TEXT="$*"; [ -z "${TEXT// }" ] && exit 0
WAV="$(mktemp -t bee-say).wav"

# 1) VibeVoice — optional remote natural voice layer (usually Lenovo over an SSH tunnel).
VIBE_HELPER="$(cd "$(dirname "$0")" && pwd)/vibevoice-say.mjs"
if { [ -n "${BEE_VIBEVOICE_URL:-}" ] || [ "${BEE_USE_VIBEVOICE:-0}" = "1" ]; } && [ -f "$VIBE_HELPER" ] && node "$VIBE_HELPER" "$TEXT" "$WAV" 2>/dev/null && [ -s "$WAV" ]; then
  afplay "$WAV" 2>/dev/null; rm -f "$WAV"; exit 0
fi

# 2) Kokoro — the default natural voice, single playback.
URL="${BEE_TTS_URL:-http://127.0.0.1:8790/v1/audio/speech}"
MODEL="${BEE_TTS_MODEL:-mlx-community/Kokoro-82M-bf16}"
KVOICE="${BEE_TTS_KOKORO_VOICE:-af_heart}"
SPEED="${BEE_TTS_SPEED:-0.96}"
payload=$(python3 -c 'import json,sys;print(json.dumps({"model":sys.argv[1],"input":sys.argv[2],"voice":sys.argv[3],"speed":float(sys.argv[4])}))' "$MODEL" "$TEXT" "$KVOICE" "$SPEED" 2>/dev/null)
if [ -n "$payload" ] && curl -fs -m 25 "$URL" -H 'content-type: application/json' -d "$payload" -o "$WAV" 2>/dev/null && [ -s "$WAV" ]; then
  afplay "$WAV" 2>/dev/null; rm -f "$WAV"; exit 0
fi

# 3) Voicebox — opt-in expressive backup. Qwen CustomVoice, mood-driven via BEE_VOICEBOX_INSTRUCT.
#    No double: if the Voicebox app self-plays, set BEE_VOICEBOX_SELFPLAY=1 to skip afplay.
VOICEBOX_HELPER="$(cd "$(dirname "$0")" && pwd)/voicebox-say.mjs"
if [ "${BEE_USE_VOICEBOX:-0}" = "1" ] && [ -f "$VOICEBOX_HELPER" ] && node "$VOICEBOX_HELPER" "$TEXT" "$WAV" 2>/dev/null && [ -s "$WAV" ]; then
  [ "${BEE_VOICEBOX_SELFPLAY:-0}" = "1" ] || afplay "$WAV" 2>/dev/null
  rm -f "$WAV"; exit 0
fi

# 4) PersonaPlex shim, if configured.
PPLEX="${BEE_PERSONAPLEX_URL:-}"
if [ -n "$PPLEX" ]; then
  pp=$(python3 -c 'import json,sys;print(json.dumps({"input":sys.argv[1],"voice":sys.argv[2]}))' "$TEXT" "${BEE_PERSONAPLEX_VOICE:-bee}" 2>/dev/null)
  if curl -fs -m 25 "$PPLEX" -H 'content-type: application/json' -d "$pp" -o "$WAV" 2>/dev/null && [ -s "$WAV" ]; then
    afplay "$WAV" 2>/dev/null; rm -f "$WAV"; exit 0
  fi
fi

# 5) macOS say — last resort.
say -v "${BEE_VOICE:-Samantha}" -r "${BEE_RATE:-180}" "$TEXT" 2>/dev/null
rm -f "$WAV"
