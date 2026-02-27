/**
 * Tests for the AgentPayClient.
 */

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { AgentPayClient } from '../src/clients/agentpayClient';

const config = {
  baseUrl: 'http://localhost:3001',
  apiKey: 'test-api-key-123',
  dashboardUrl: 'http://localhost:3000',
};

function mockResponse(body: unknown, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

describe('AgentPayClient', () => {
  let client: AgentPayClient;

  beforeEach(() => {
    client = new AgentPayClient(config);
    mockFetch.mockClear();
  });

  describe('createTipIntent', () => {
    it('calls the correct endpoint and returns tip intent', async () => {
      const mockResult = { success: true, tipId: 'tip_abc', sessionUrl: 'https://example.com' };
      mockResponse(mockResult);

      const result = await client.createTipIntent('streamer1', 10, 'USDC');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/streamers/streamer1/tip-intent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-api-key-123' }),
          body: JSON.stringify({ amount: 10, currency: 'USDC', memo: undefined }),
        })
      );
      expect(result).toEqual(mockResult);
    });

    it('throws on non-ok response', async () => {
      mockResponse({ error: 'Not found' }, false, 404);
      await expect(client.createTipIntent('streamer1', 10)).rejects.toThrow('Not found');
    });
  });

  describe('verifyTip', () => {
    const txHash = '5KtSyQPmKXkZ1J7VrALLNdQmC5h3iVx';

    it('calls verify endpoint and returns valid result', async () => {
      mockResponse({ success: true, data: { transactionId: 'tx_001' } });

      const result = await client.verifyTip(txHash);

      expect(result.valid).toBe(true);
      expect(result.transactionId).toBe('tx_001');
    });

    it('returns invalid result on non-ok response', async () => {
      mockResponse({ error: 'Not verified' }, false, 402);

      const result = await client.verifyTip(txHash);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Not verified');
    });
  });

  describe('getOverlayUrl', () => {
    it('returns the overlay URL using dashboardUrl when set', () => {
      const url = client.getOverlayUrl('streamer1');
      expect(url).toBe('http://localhost:3000/overlay/streamer1');
    });

    it('falls back to baseUrl when dashboardUrl is not set', () => {
      const clientNoDash = new AgentPayClient({ baseUrl: 'http://localhost:3001', apiKey: 'k' });
      expect(clientNoDash.getOverlayUrl('streamer1')).toBe('http://localhost:3001/overlay/streamer1');
    });
  });

  describe('getTipPageUrl', () => {
    it('returns the tip page URL using dashboardUrl when set', () => {
      const url = client.getTipPageUrl('streamer1');
      expect(url).toBe('http://localhost:3000/tip/streamer1');
    });

    it('falls back to baseUrl when dashboardUrl is not set', () => {
      const clientNoDash = new AgentPayClient({ baseUrl: 'http://localhost:3001', apiKey: 'k' });
      expect(clientNoDash.getTipPageUrl('streamer1')).toBe('http://localhost:3001/tip/streamer1');
    });
  });
});
