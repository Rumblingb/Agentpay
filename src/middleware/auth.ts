import { Request, Response, NextFunction } from 'express';
import * as merchantsService from '../services/merchants';
import { logger } from '../logger';

export interface AuthRequest extends Request {
  merchant?: {
    id: string;
    name: string;
    email: string;
    walletAddress: string;
  };
}

export async function authenticateApiKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    // 1. Check if header exists
    if (!authHeader) {
      logger.warn('[Auth] Missing authorization header');
      res.status(401).json({
        code: 'AUTH_MISSING',
        message: 'Missing authorization header',
      });
      return;
    }

    // 2. Handle both 'Bearer <key>' and 'Bearer<key>' (common in some automated tests)
    // and ensure the format is correct
    const parts = authHeader.split(' ');
    let apiKey: string;

    if (parts.length === 2 && parts[0] === 'Bearer') {
      apiKey = parts[1];
    } else if (authHeader.startsWith('Bearer')) {
      // Fallback for missing space: "BearerYOUR_KEY"
      apiKey = authHeader.substring(6).trim();
    } else {
      logger.warn('[Auth] Invalid header format', { header: authHeader });
      res.status(401).json({
        code: 'AUTH_INVALID_FORMAT',
        message: 'Invalid authorization header format. Use "Bearer <key>"',
      });
      return;
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

    // 4. Call the service
    const merchant = await merchantsService.authenticateMerchant(apiKey);

    if (!merchant) {
      logger.warn('[Auth] Authentication failed for key', { 
        keyPreview: `${apiKey.substring(0, 8)}...` 
      });
      res.status(401).json({
        code: 'AUTH_INVALID',
        message: 'Invalid API key',
      });
      return;
    }

    // 5. Success
    req.merchant = merchant;
    next();
  } catch (error: any) {
    // Log the actual error stack for debugging
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