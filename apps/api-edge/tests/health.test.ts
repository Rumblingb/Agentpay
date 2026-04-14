import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../src/types';
import { createDb } from '../src/lib/db';
import { healthRouter } from '../src/routes/health';

vi.mock('../src/lib/db', () => ({
  createDb: vi.fn(),
}));

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', healthRouter);
  return app;
}

type HealthResponse = {
  status: 'active' | 'degraded';
  services: {
    database: {
      status: 'operational' | 'degraded';
    };
  };
};

type SqlProbe = ReturnType<typeof vi.fn> & {
  end: ReturnType<typeof vi.fn>;
};

function makeSqlProbe(options?: { queryError?: Error; endError?: Error }) {
  const sql: SqlProbe = Object.assign(vi.fn(), { end: vi.fn() });

  if (options?.queryError) {
    sql.mockRejectedValue(options.queryError);
  } else {
    sql.mockResolvedValue([{ '?column?': 1 }]);
  }

  if (options?.endError) {
    sql.end.mockRejectedValue(options.endError);
  } else {
    sql.end.mockResolvedValue(undefined);
  }

  return sql;
}

describe('health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 200 active when the database probe succeeds', async () => {
    const sql = makeSqlProbe();
    vi.mocked(createDb).mockReturnValue(sql as never);

    const res = await makeApp().request('/health', undefined, {
      DATABASE_URL: 'postgres://db.example/agentpay',
    } as Env);
    const body = (await res.json()) as HealthResponse;

    expect(res.status).toBe(200);
    expect(body.status).toBe('active');
    expect(body.services.database.status).toBe('operational');
    expect(createDb).toHaveBeenCalledOnce();
    expect(sql).toHaveBeenCalledOnce();
    expect(sql.end).toHaveBeenCalledOnce();
  });

  it('returns 503 degraded when the database probe fails', async () => {
    const sql = makeSqlProbe({ queryError: new Error('connection refused') });
    vi.mocked(createDb).mockReturnValue(sql as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await makeApp().request('/api/health', undefined, {
      DATABASE_URL: 'postgres://db.example/agentpay',
    } as Env);
    const body = (await res.json()) as HealthResponse;

    expect(res.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.services.database.status).toBe('degraded');
    expect(sql.end).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns 503 degraded when no database connection is configured', async () => {
    const res = await makeApp().request('/health', undefined, {} as Env);
    const body = (await res.json()) as HealthResponse;

    expect(res.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.services.database.status).toBe('degraded');
    expect(createDb).not.toHaveBeenCalled();
  });
});
