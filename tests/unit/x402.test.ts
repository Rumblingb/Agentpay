/**
 * Unit tests for x402 Payment Required middleware.
 */

import { x402Headers, sendPaymentRequired } from '../../src/middleware/x402';
import { Request, Response, NextFunction } from 'express';

describe('x402 middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let headers: Record<string, string>;

  beforeEach(() => {
    headers = {};
    mockReq = {
      merchant: undefined,
    } as any;
    mockRes = {
      statusCode: 200,
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
        return mockRes as Response;
      }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('x402Headers', () => {
    it('calls next to continue the middleware chain', () => {
      x402Headers(mockReq as any, mockRes as any, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('wraps res.json to add x402 headers on 402 responses', () => {
      x402Headers(mockReq as any, mockRes as any, mockNext);

      // Simulate a 402 response
      mockRes.statusCode = 402;
      (mockRes.json as jest.Mock)({ message: 'Payment required' });

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Payment-Required', 'true');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Payment-Network', 'solana');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Payment-Token', 'USDC');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Payment-Protocol', 'agentpay-x402/1.0');
    });

    it('does NOT add x402 headers on non-402 responses', () => {
      x402Headers(mockReq as any, mockRes as any, mockNext);

      mockRes.statusCode = 200;
      (mockRes.json as jest.Mock)({ success: true });

      expect(mockRes.setHeader).not.toHaveBeenCalledWith('X-Payment-Required', 'true');
    });
  });

  describe('sendPaymentRequired', () => {
    it('sends a 402 response with x402 headers', () => {
      sendPaymentRequired(mockRes as any, {
        message: 'You need to pay',
        amount: 1.50,
        recipientAddress: 'wallet-123',
        merchantId: 'merchant-456',
      });

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Payment-Required', 'true');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Payment-Amount', '1.5');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Payment-Address', 'wallet-123');
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'PAYMENT_REQUIRED',
          message: 'You need to pay',
          payment: expect.objectContaining({
            network: 'solana',
            token: 'USDC',
            amount: 1.5,
            recipientAddress: 'wallet-123',
            protocol: 'agentpay-x402/1.0',
          }),
        }),
      );
    });

    it('uses default message when none provided', () => {
      sendPaymentRequired(mockRes as any);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Payment required to access this resource',
        }),
      );
    });
  });
});
