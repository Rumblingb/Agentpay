/**
 * Unit tests for delegationService.
 * db.query is mocked so no live DB is required.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import * as db from '../../src/db/index';
import {
  createDelegation,
  authorizeDelegation,
  revokeDelegation,
} from '../../src/services/delegationService';

const mockQuery = db.query as jest.Mock;

const AGENT_ID = 'agent-deleg-001';

describe('delegationService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------- createDelegation ----------
  describe('createDelegation', () => {
    it('returns a delegationId and publicKey', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const result = await createDelegation(AGENT_ID, { publicKey: 'pubKey-abc' });
      expect(result).toHaveProperty('delegationId');
      expect(result.publicKey).toBe('pubKey-abc');
    });

    it('generates a UUID as delegationId', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const { delegationId } = await createDelegation(AGENT_ID, { publicKey: 'pk' });
      expect(delegationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('passes spendingLimit to the INSERT', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await createDelegation(AGENT_ID, { publicKey: 'pk', spendingLimit: 250 });
      const [, values] = mockQuery.mock.calls[0];
      expect(values).toContain(250);
    });

    it('passes null spendingLimit when omitted', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await createDelegation(AGENT_ID, { publicKey: 'pk' });
      const [, values] = mockQuery.mock.calls[0];
      expect(values[3]).toBeNull(); // spendingLimit position
    });

    it('passes expiresAt when provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const expiry = '2030-01-01T00:00:00.000Z';
      await createDelegation(AGENT_ID, { publicKey: 'pk', expiresAt: expiry });
      const [, values] = mockQuery.mock.calls[0];
      expect(values).toContain(expiry);
    });

    it('inserts with is_active = false by default', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await createDelegation(AGENT_ID, { publicKey: 'pk' });
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('false');
    });

    it('propagates DB errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('unique constraint violation'));
      await expect(createDelegation(AGENT_ID, { publicKey: 'pk' })).rejects.toThrow(
        'unique constraint violation'
      );
    });
  });

  // ---------- authorizeDelegation ----------
  describe('authorizeDelegation', () => {
    it('resolves when rowCount > 0', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      await expect(authorizeDelegation('deleg-1', AGENT_ID)).resolves.toBeUndefined();
    });

    it('throws when delegation not found or not owned by agent', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      await expect(authorizeDelegation('deleg-missing', AGENT_ID)).rejects.toThrow(
        'Delegation not found or not owned by agent'
      );
    });

    it('sets is_active = true in the UPDATE statement', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      await authorizeDelegation('deleg-1', AGENT_ID);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('is_active = true');
    });

    it('filters by both delegationId and agentId (ownership check)', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      await authorizeDelegation('deleg-123', 'agent-456');
      const [, values] = mockQuery.mock.calls[0];
      expect(values).toContain('deleg-123');
      expect(values).toContain('agent-456');
    });
  });

  // ---------- revokeDelegation ----------
  describe('revokeDelegation', () => {
    it('resolves when rowCount > 0', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      await expect(revokeDelegation('deleg-1', AGENT_ID)).resolves.toBeUndefined();
    });

    it('throws when delegation not found or not owned by agent', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      await expect(revokeDelegation('deleg-gone', AGENT_ID)).rejects.toThrow(
        'Delegation not found or not owned by agent'
      );
    });

    it('sets is_active = false in the UPDATE statement', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      await revokeDelegation('deleg-1', AGENT_ID);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('is_active = false');
    });

    it('filters by both delegationId and agentId (anti-spoofing)', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      await revokeDelegation('deleg-xyz', 'agent-abc');
      const [, values] = mockQuery.mock.calls[0];
      expect(values).toContain('deleg-xyz');
      expect(values).toContain('agent-abc');
    });
  });
});