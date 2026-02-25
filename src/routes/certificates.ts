import { Router, Request, Response } from 'express';
import { validateCertificate } from '../services/certificateService';
import { logger } from '../logger';

const router = Router();

// POST /api/certificates/validate – public endpoint to validate a certificate
router.post('/validate', (req: Request, res: Response) => {
  const { encoded } = req.body;

  if (!encoded || typeof encoded !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "encoded" field' });
    return;
  }

  try {
    const payload = validateCertificate(encoded);
    if (payload) {
      res.json({ valid: true, payload });
    } else {
      res.status(200).json({ valid: false });
    }
  } catch (err: any) {
    logger.error('Certificate validation error:', err);
    res.status(500).json({ error: 'Certificate validation failed' });
  }
});

export default router;
