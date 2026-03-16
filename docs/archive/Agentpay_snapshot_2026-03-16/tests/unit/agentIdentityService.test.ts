/**
 * Unit tests for agentIdentityService.
 * db.query is mocked so no live DB is required.
 * bcrypt is mocked to keep tests fast.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

// Speed up bcrypt in tests
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-pin-value'),
  compare: jest.fn(),
}));

import * as db from '../../src/db/index';
import * as bcrypt from 'bcrypt';
import {
  registerAgent,
  updateAgent,
  verifyPin,
} from '../../src/services/agentIdentityService';

const mockQuery = db.query as jest.Mock;
const mockBcryptHash = bcrypt.hash as jest.Mock;
const mockBcryptCompare = bcrypt.compare as jest.Mock;

describe('agentIdentityService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------- registerAgent ----------
  describe('registerAgent', () => {
    it('inserts a new agent and returns a UUID agentId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const result = await registerAgent({});
      expect(result).toHaveProperty('agentId');
      expect(typeof result.agentId).toBe('string');
      expect(result.agentId.length).toBeGreaterThan(10);
    });

    it('passes agentPublicKey to the INSERT', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await registerAgent({ agentPublicKey: 'pubKey-abc' });
      const call = mockQuery.mock.calls[0];
      expect(call[1]).toContain('pubKey-abc');
    });

    it('hashes PIN before storing (uses bcrypt)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await registerAgent({ pin: '1234' });
      expect(mockBcryptHash).toHaveBeenCalledWith('1234', 12);
      const call = mockQuery.mock.calls[0];
      expect(call[1]).toContain('hashed-pin-value');
    });

    it('stores null pin_hash when no PIN provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await registerAgent({});
      const call = mockQuery.mock.calls[0];
      expect(call[1][3]).toBeNull(); // pin_hash position
    });

    it('stores spendingLimit when provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await registerAgent({ spendingLimit: 500 });
      const call = mockQuery.mock.calls[0];
      expect(call[1]).toContain(500);
    });

    it('stores null spendingLimit when omitted', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await registerAgent({});
      const call = mockQuery.mock.calls[0];
      expect(call[1][2]).toBeNull();
    });

    it('propagates DB errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection refused'));
      await expect(registerAgent({})).rejects.toThrow('DB connection refused');
    });
  });

  // ---------- updateAgent ----------
  describe('updateAgent', () => {
    const agentId = 'agent-uuid-9999';

    it('does nothing when no fields provided', async () => {
      await updateAgent(agentId, {});
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('updates agentPublicKey', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await updateAgent(agentId, { agentPublicKey: 'newPubKey' });
      const [sql, values] = mockQuery.mock.calls[0];
      expect(sql).toContain('agent_public_key');
      expect(values).toContain('newPubKey');
    });

    it('updates spendingLimit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await updateAgent(agentId, { spendingLimit: 1000 });
      const [sql, values] = mockQuery.mock.calls[0];
      expect(sql).toContain('spending_limit');
      expect(values).toContain(1000);
    });

    it('hashes new PIN when updating pin', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await updateAgent(agentId, { pin: '5678' });
      expect(mockBcryptHash).toHaveBeenCalledWith('5678', 12);
      const [sql, values] = mockQuery.mock.calls[0];
      expect(sql).toContain('pin_hash');
      expect(values).toContain('hashed-pin-value');
    });

    it('updates deviceFingerprint', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await updateAgent(agentId, { deviceFingerprint: 'fp-abc' });
      const [sql, values] = mockQuery.mock.calls[0];
      expect(sql).toContain('device_fingerprint');
      expect(values).toContain('fp-abc');
    });

    it('always appends updated_at', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await updateAgent(agentId, { agentPublicKey: 'k' });
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('updated_at');
    });
  });

  // ---------- verifyPin ----------
  describe('verifyPin', () => {
    const agentId = 'agent-pin-test';

    it('returns false when agent not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await verifyPin(agentId, '1234');
      expect(result).toBe(false);
    });

    it('returns false when agent has no pin_hash', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ pin_hash: null }] });
      const result = await verifyPin(agentId, '1234');
      expect(result).toBe(false);
    });

    it('returns true when bcrypt.compare resolves true', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ pin_hash: 'hashed' }] });
      mockBcryptCompare.mockResolvedValueOnce(true);
      const result = await verifyPin(agentId, '1234');
      expect(result).toBe(true);
    });

    it('returns false when bcrypt.compare resolves false (wrong PIN)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ pin_hash: 'hashed' }] });
      mockBcryptCompare.mockResolvedValueOnce(false);
      const result = await verifyPin(agentId, 'wrong');
      expect(result).toBe(false);
    });

    it('queries by agentId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await verifyPin('agent-xyz', '0000');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['agent-xyz']
      );
    });
  });
});