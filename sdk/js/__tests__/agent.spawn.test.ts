import { Agent } from '../src/agent';

const originalFetch = global.fetch;

beforeEach(() => {
  // mock fetch
  (global as any).fetch = jest.fn();
});

afterEach(() => {
  (global as any).fetch = originalFetch;
  jest.resetAllMocks();
});

test('Agent.spawn posts to spawn-agent and returns parsed JSON', async () => {
  const mockResponse = {
    success: true,
    intentId: 'intent-123',
    transactionId: 'tx-123',
    amount: 0.1,
    agent: { id: 'agent-1', name: 'DemoAgent', trust: 97 },
    receiptSvg: '<svg></svg>',
  };

  (global as any).fetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse });

  const cfg = { baseUrl: 'http://localhost:3000', apiKey: 'testkey', timeoutMs: 2000 };
  const res = await Agent.spawn(cfg, { displayName: 'DemoAgent' });

  expect(res).toEqual(mockResponse);
  expect((global as any).fetch).toHaveBeenCalled();
});
