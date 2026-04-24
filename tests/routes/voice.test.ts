import { voiceRouter } from '../../apps/api-edge/src/routes/voice';

describe('voiceRouter NVIDIA voice providers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('proxies STT through the NVIDIA speech bridge when configured', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ transcript: 'Paddington to Bristol' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const audio = Buffer.from('demo-audio').toString('base64');
    const response = await voiceRouter.fetch(
      new Request('http://voice.test/transcribe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bro-key': 'secret',
        },
        body: JSON.stringify({ audio, mimeType: 'audio/m4a' }),
      }),
      {
        BRO_CLIENT_KEY: 'secret',
        ACE_STT_PROVIDER: 'nvidia',
        ACE_STT_LANGUAGE_CODE: 'en-US',
        NVIDIA_SPEECH_BRIDGE_URL: 'http://bridge.test',
        NVIDIA_SPEECH_BRIDGE_TOKEN: 'bridge-token',
      } as never,
      {} as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ transcript: 'Paddington to Bristol' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://bridge.test/transcribe',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bridge-token',
        }),
      }),
    );
  });

  it('proxies TTS through the NVIDIA speech bridge when configured', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const response = await voiceRouter.fetch(
      new Request('http://voice.test/tts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bro-key': 'secret',
        },
        body: JSON.stringify({ text: 'Your train is ready.' }),
      }),
      {
        BRO_CLIENT_KEY: 'secret',
        ACE_TTS_PROVIDER: 'nvidia',
        ACE_TTS_LANGUAGE_CODE: 'en-US',
        ACE_NVIDIA_TTS_VOICE_NAME: 'Magpie-Multilingual.EN-US.Aria',
        NVIDIA_SPEECH_BRIDGE_URL: 'http://bridge.test',
        NVIDIA_SPEECH_BRIDGE_TOKEN: 'bridge-token',
      } as never,
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://bridge.test/tts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bridge-token',
        }),
      }),
    );
  });
});
