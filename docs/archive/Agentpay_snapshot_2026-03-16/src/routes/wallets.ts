/**
 * Hosted Wallet Routes — /api/wallets
 *
 * Provides custodial Solana wallets for walletless agents (e.g. Moltbook bots).
 * The private key is stored server-side, AES-256-GCM encrypted.
 *
 * Endpoints:
 *   POST /api/wallets/create            — provision a new wallet for an agent
 *   GET  /api/wallets/:agentId          — get wallet info (no private key)
 *   GET  /api/wallets/:agentId/balance  — sync + return on-chain balance
 *   POST /api/wallets/:agentId/send     — send USDC from hosted wallet
 *
 * @module routes/wallets
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import * as walletService from '../services/walletService.js';
import { authenticateApiKey } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();

// Maximum single-transaction send limit.
// Protects against fat-finger mistakes and reduces blast radius if a key is compromised.
// Raise in Render env vars via WALLET_MAX_SEND_USDC if needed.
const MAX_WALLET_SEND_USDC = parseInt(process.env.WALLET_MAX_SEND_USDC ?? '100000', 10);

// Strict rate limit on wallet operations — these touch real keys
const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many wallet requests, please slow down.' },
});

router.use(walletLimiter);

// --- Schemas ---
const createWalletSchema = z.object({
  agentId: z.string().min(1).max(255),
  label: z.string().min(1).max(100).optional(),
});

const sendSchema = z.object({
  toAddress: z.string().min(32).max(44),
  amountUsdc: z.number().positive().max(MAX_WALLET_SEND_USDC),
});

/**
 * POST /api/wallets/create
 *
 * Provision a new hosted wallet for an agent.
 * Returns the public key — the private key is stored encrypted on the server.
 *
 * @auth Merchant API key required
 */
router.post('/create', authenticateApiKey, async (req: Request, res: Response) => {
  const parsed = createWalletSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
    });
    return;
  }

  const { agentId, label } = parsed.data;

  try {
    const wallet = await walletService.createWallet(agentId, label);
    res.status(201).json({
      success: true,
      wallet,
      message: 'Hosted wallet created. The private key is stored encrypted on the server.',
    });
  } catch (err: any) {
    if (err.message?.includes('already exists')) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error('Wallet creation error', { err });
    res.status(500).json({ error: 'Failed to create wallet' });
  }
});

/**
 * GET /api/wallets/:agentId
 *
 * Get wallet info (public key + DB balance).
 *
 * @auth Merchant API key required
 */
router.get('/:agentId', authenticateApiKey, async (req: Request, res: Response) => {
  const { agentId } = req.params;

  try {
    const wallet = await walletService.getWallet(agentId);
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found for this agent' });
      return;
    }
    res.json({ success: true, wallet });
  } catch (err: any) {
    logger.error('Wallet fetch error', { err });
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

/**
 * GET /api/wallets/:agentId/balance
 *
 * Sync the on-chain USDC balance and return it.
 * Falls back to DB balance if the Solana RPC is unavailable.
 *
 * @auth Merchant API key required
 */
router.get('/:agentId/balance', authenticateApiKey, async (req: Request, res: Response) => {
  const { agentId } = req.params;

  try {
    const wallet = await walletService.getWallet(agentId);
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found for this agent' });
      return;
    }

    const onChainBalance = await walletService.syncBalance(agentId);
    const balanceUsdc = onChainBalance ?? wallet.balanceUsdc;

    res.json({
      success: true,
      agentId,
      publicKey: wallet.publicKey,
      balanceUsdc,
      source: onChainBalance !== null ? 'on-chain' : 'db-cache',
    });
  } catch (err: any) {
    logger.error('Balance sync error', { err });
    res.status(500).json({ error: 'Failed to sync balance' });
  }
});

/**
 * POST /api/wallets/:agentId/send
 *
 * Send USDC from a hosted wallet to any Solana address.
 *
 * @auth Merchant API key required
 */
router.post('/:agentId/send', authenticateApiKey, async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const parsed = sendSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation error',
      details: parsed.error.issues.map((e) => e.message),
    });
    return;
  }

  const { toAddress, amountUsdc } = parsed.data;

  try {
    const result = await walletService.sendUsdc(agentId, toAddress, amountUsdc);
    res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    if (err.message?.includes('Insufficient balance') || err.message?.includes('not found')) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err.message?.includes('deactivated')) {
      res.status(403).json({ error: err.message });
      return;
    }
    logger.error('Wallet send error', { err });
    res.status(500).json({ error: 'Failed to send USDC' });
  }
});

export default router;
