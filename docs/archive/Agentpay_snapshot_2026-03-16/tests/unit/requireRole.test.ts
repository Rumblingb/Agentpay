/**
 * Unit tests for the RBAC (requireRole) middleware.
 */

import { Request, Response } from 'express';

// Mock DB before any imports
jest.mock('../../src/db/index', () => ({
  query: jest.fn(),
  pool: { on: jest.fn(), end: jest.fn() },
}));

jest.mock('../../src/lib/prisma', () => ({ default: {} }));

import { resolveRoles, requireRole, RbacRequest } from '../../src/middleware/requireRole.js';

function makeReq(overrides: Partial<RbacRequest> = {}): RbacRequest {
  return {
    headers: {},
    path: '/test',
    method: 'GET',
    ...overrides,
  } as unknown as RbacRequest;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('resolveRoles middleware', () => {
  const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'admin-dev-key';

  it('assigns admin role when x-admin-key matches', async () => {
    const req = makeReq({ headers: { 'x-admin-key': ADMIN_KEY } });
    const res = makeRes();
    const next = jest.fn();

    await resolveRoles(req, res as Response, next);

    expect(req.roles).toContain('admin');
    expect(next).toHaveBeenCalled();
  });

  it('assigns platform role when x-platform-key is present', async () => {
    const req = makeReq({ headers: { 'x-platform-key': 'some-key' } });
    const res = makeRes();
    const next = jest.fn();

    await resolveRoles(req, res as Response, next);

    expect(req.roles).toContain('platform');
    expect(next).toHaveBeenCalled();
  });

  it('assigns merchant role when req.merchant is set', async () => {
    const req = makeReq({
      headers: {},
      merchant: { id: 'mid', name: 'Test', email: 'test@test.com', walletAddress: 'abc' },
    } as any);
    const res = makeRes();
    const next = jest.fn();

    await resolveRoles(req, res as Response, next);

    expect(req.roles).toContain('merchant');
    expect(next).toHaveBeenCalled();
  });

  it('assigns no roles for unauthenticated request', async () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = jest.fn();

    await resolveRoles(req, res as Response, next);

    expect(req.roles).toEqual([]);
    expect(next).toHaveBeenCalled();
  });
});

describe('requireRole middleware', () => {
  it('passes when user has required role', () => {
    const req = makeReq({ roles: ['merchant'] } as any);
    const res = makeRes();
    const next = jest.fn();

    requireRole(['merchant'])(req, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes when user has admin role (admin always passes)', () => {
    const req = makeReq({ roles: ['admin'] } as any);
    const res = makeRes();
    const next = jest.fn();

    requireRole(['merchant'])(req, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when user lacks required role', () => {
    const req = makeReq({ roles: ['merchant'] } as any);
    const res = makeRes();
    const next = jest.fn();

    requireRole(['admin', 'platform'])(req, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RBAC_FORBIDDEN' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when no roles are set', () => {
    const req = makeReq({} as any);
    const res = makeRes();
    const next = jest.fn();

    requireRole(['admin'])(req, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
