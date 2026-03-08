/**
 * Tests for the API status and health check routes added in the production fix.
 * GET /api       — must return 200 with status "AgentPay API Active"
 * GET /api/health — must return 200 or 503 with a structured health payload
 * GET /notfound  — must return 404 JSON (not HTML)
 */

import { jest, describe, it, expect } from '@jest/globals';

// Mock the DB pool used by the health check handler
const mockQuery = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
jest.mock('../src/db/index', () => ({
  __esModule: true,
  query: (...args: any[]) => mockQuery(...args),
  pool: { on: jest.fn(), query: (...args: any[]) => mockQuery(...args) },
  closePool: jest.fn(),
}));

import request from 'supertest';
import app from '../src/server';

describe('API status and health routes', () => {
  it('GET /api returns 200 with status message', async () => {
    const res = await request(app).get('/api');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('AgentPay API Active');
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.docs).toBe('/api/docs');
  });

  it('GET /health returns a structured health payload', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body.services).toHaveProperty('database');
    expect(res.body.version).toBe('1.0.0');
  });

  it('GET /api/health returns the same payload as /health', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body.services).toHaveProperty('database');
    expect(res.body.version).toBe('1.0.0');
  });

  it('GET /api/nonexistent returns 404 JSON (not HTML)', async () => {
    const res = await request(app).get('/api/nonexistent-route-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(res.body.docs).toBe('/api/docs');
    // Ensure response is JSON, not the Express default HTML 404
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
