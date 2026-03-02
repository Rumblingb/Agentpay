/**
 * Unit tests for emergencyPause middleware.
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  closePool: jest.fn().mockResolvedValue(undefined),
}));

import { checkEmergencyPause } from '../../src/middleware/emergencyPause';
import * as db from '../../src/db/index';
import { Request, Response, NextFunction } from 'express';

const mockQuery = db.query as jest.Mock;

describe('emergencyPause middleware', () => {
  let mockReq: any;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = { merchant: { id: 'merchant-uuid-1234' }, path: '/test' };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('calls next() when merchant is not paused', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ emergency_pause: false }] });

    await checkEmergencyPause(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('returns 503 when merchant has emergency_pause=true', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ emergency_pause: true }] });

    await checkEmergencyPause(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(503);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'SERVICE_PAUSED',
      }),
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next() when no merchant is on the request', async () => {
    mockReq = { path: '/test' };

    await checkEmergencyPause(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('gracefully handles missing emergency_pause column', async () => {
    mockQuery.mockRejectedValueOnce(new Error('column "emergency_pause" does not exist'));

    await checkEmergencyPause(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });
});
