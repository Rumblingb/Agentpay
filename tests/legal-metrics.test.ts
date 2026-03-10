/**
 * Unit tests for the /api/legal route.
 */

// Mock DB before imports
jest.mock('../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn(), end: jest.fn() },
}));

jest.mock('../src/lib/prisma', () => ({ default: {} }));

import request from 'supertest';
import app from '../src/server.js';

describe('GET /api/legal', () => {
  it('returns policy version and policy list', async () => {
    const res = await request(app).get('/api/legal');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('policies');
    expect(res.body.policies).toHaveProperty('terms-of-service');
    expect(res.body.policies).toHaveProperty('privacy-policy');
    expect(res.body.policies).toHaveProperty('non-custodial-disclaimer');
  });

  it('returns contact field', async () => {
    const res = await request(app).get('/api/legal');
    expect(res.body).toHaveProperty('contact');
  });
});

describe('GET /metrics', () => {
  it('returns Prometheus text format', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# TYPE http_requests_total counter');
  });
});
