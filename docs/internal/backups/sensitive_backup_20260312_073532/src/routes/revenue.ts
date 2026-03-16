import { Router } from 'express';
import { authenticateApiKey } from '../middleware/auth.js';
import { RevenueController } from '../controllers/revenueController.js';

const router = Router();

// All revenue endpoints require API key authentication
router.use(authenticateApiKey);

// Layer 1: Credit Consumption (Human → Bot)
router.post('/credits', RevenueController.handleCreditConsumption);

// Layer 2: On-Chain Verification (Bot → Bot)
router.post('/verification', RevenueController.handleOnChainVerification);

// Layer 3: Marketplace Commission (Service sales)
router.post('/marketplace', RevenueController.handleMarketplaceCommission);

// Layer 4: Subscription Recurring (SaaS tiers)
router.post('/subscription', RevenueController.handleSubscriptionRecurring);

// Revenue summary (aggregated across all streams)
router.get('/summary', RevenueController.handleGetRevenueSummary);

export default router;
