/**
 * Route tests for POST /api/certificates/validate
 */

jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn() },
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    merchant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    paymentIntent: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    verificationCertificate: { create: jest.fn() },
    agentrank_scores: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    agent: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  },
}));

// Mock certificate service
jest.mock('../../src/services/certificateService', () => ({
  validateCertificate: jest.fn(),
  signCertificate: jest.fn(),
}));

import request from 'supertest';
import app from '../../src/server';
import * as certService from '../../src/services/certificateService';

const mockValidate = certService.validateCertificate as jest.Mock;

describe('POST /api/certificates/validate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with valid:true and payload for a valid certificate', async () => {
    const payload = { intentId: 'abc-123', amount: 5.0 };
    mockValidate.mockReturnValueOnce(payload);

    const res = await request(app)
      .post('/api/certificates/validate')
      .send({ encoded: 'valid-encoded-cert' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.payload).toMatchObject(payload);
  });

  it('returns 200 with valid:false for an invalid certificate', async () => {
    mockValidate.mockReturnValueOnce(null);

    const res = await request(app)
      .post('/api/certificates/validate')
      .send({ encoded: 'tampered-cert' });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it('returns 400 when encoded field is missing', async () => {
    const res = await request(app)
      .post('/api/certificates/validate')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('encoded');
  });

  it('returns 400 when encoded field is not a string', async () => {
    const res = await request(app)
      .post('/api/certificates/validate')
      .send({ encoded: 12345 });

    expect(res.status).toBe(400);
  });

  it('returns 500 when validateCertificate throws', async () => {
    mockValidate.mockImplementationOnce(() => {
      throw new Error('Decode failed');
    });

    const res = await request(app)
      .post('/api/certificates/validate')
      .send({ encoded: 'bad-cert' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('failed');
  });

  it('rejects requests with no body', async () => {
    const res = await request(app)
      .post('/api/certificates/validate')
      .send();

    expect(res.status).toBe(400);
  });

  it('rejects encoded field that is null', async () => {
    const res = await request(app)
      .post('/api/certificates/validate')
      .send({ encoded: null });

    expect(res.status).toBe(400);
  });
});
