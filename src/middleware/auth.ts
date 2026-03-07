import { Request, Response, NextFunction } from 'express';
import * as merchantsService from '../services/merchants.js';
import { logger } from '../logger.js';

export interface AuthRequest extends Request {
  merchant?: {
    id: string;
    name: string;
    email: string;
    walletAddress: string;
    webhookUrl?: string | null;
  };
}

export async function authenticateApiKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization || req.headers['x-api-key'] as string;
    
    // 1. Check if header exists
    if (!authHeader) {
      logger.warn('[Auth] Missing authorization header');
      res.status(401).json({
        code: 'AUTH_MISSING',
        message: 'Provide a token or API key.',
      });
      return;
    }

    // 2. Extract API Key (Handles Bearer, x-api-key, or raw strings)
    let apiKey: string;
    if (authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.split(' ')[1];
    } else if (authHeader.startsWith('Bearer')) {
      apiKey = authHeader.substring(6).trim();
    } else {
      apiKey = authHeader; // Raw key provided in x-api-key or Authorization
    }

    // 3. Prevent calling service with empty/undefined string
    if (!apiKey || apiKey === 'undefined' || apiKey === 'null') {
      logger.warn('[Auth] API Key extracted was empty or literal "undefined"');
      res.status(401).json({
        code: 'AUTH_INVALID',
        message: 'Invalid API key provided',
      });
      return;
    }

    // --- NEW: DEVELOPMENT BYPASS ---
    // If we are in test mode and the simulation key is used, skip DB hashing
    if (process.env.AGENTPAY_TEST_MODE === 'true' && apiKey === 'sk_test_sim_12345') {
      logger.info('[Auth] 🧪 Using development bypass for simulation key');
      req.merchant = {
        id: '26e7ac4f-017e-4316-bf4f-9a1b37112510',
        name: 'Test Merchant',
        email: 'test@agentpay.com',
        walletAddress: '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H' // From your screenshot
      };
      return next();
    }

    // 4. Call the service
    const merchant = await merchantsService.authenticateMerchant(apiKey);

    if (!merchant) {
      logger.warn('[Auth] Authentication failed for key', { 
        keyPreview: `${apiKey.substring(0, 8)}...` 
      });
      res.status(401).json({
        code: 'AUTH_INVALID',
        message: 'Invalid API key',
        help: {
          suggestion: 'Check your API key is correct and active.',
          link: 'https://docs.agentpay.gg/authentication',
          fix: 'Generate a new API key at https://dashboard.agentpay.gg/api-keys',
        },
      });
      return;
    }

    // 5. Success
    req.merchant = merchant;
    next();
  } catch (error: any) {
    logger.error('Auth middleware error:', { 
      error: error.message,
      stack: error.stack 
    });
    
    res.status(500).json({
      code: 'AUTH_ERROR',
      message: 'Internal server error during authentication',
    });
  }
}

export default authenticateApiKey;