import { Router } from 'express';
import { authenticateApiKey } from '../middleware/auth';
import { createIntent, getIntentStatus } from '../controllers/intentController';

const router = Router();

// POST /api/intents – create a new payment intent (merchant auth required)
router.post('/', authenticateApiKey, createIntent);

// GET /api/intents/:intentId/status – get intent status (merchant auth required)
router.get('/:intentId/status', authenticateApiKey, getIntentStatus);

export default router;
