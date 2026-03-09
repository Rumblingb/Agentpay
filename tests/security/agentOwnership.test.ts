/**
 * Unit tests for assertAgentOwnership utility.
 * Prisma is mocked — no live DB required.
 */

const mockFindFirst = jest.fn();

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    agent: { findFirst: mockFindFirst },
  },
}));

import { assertAgentOwnership } from '../../src/utils/assertAgentOwnership';

describe('assertAgentOwnership', () => {
  const agentId = 'agent-uuid-1111';
  const merchantId = 'merchant-uuid-2222';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves without error when the agent belongs to the merchant', async () => {
    mockFindFirst.mockResolvedValue({ id: agentId });

    await expect(assertAgentOwnership(agentId, merchantId)).resolves.toBeUndefined();

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: agentId, merchantId },
      select: { id: true },
    });
  });

  it('throws when the agent does not belong to the merchant', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(assertAgentOwnership(agentId, merchantId)).rejects.toThrow(
      'Agent not found or access denied',
    );
  });

  it('throws when the agent does not exist at all', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(assertAgentOwnership('nonexistent-agent', merchantId)).rejects.toThrow(
      'Agent not found or access denied',
    );
  });
});
