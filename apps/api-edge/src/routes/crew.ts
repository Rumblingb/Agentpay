/**
 * POST /api/crew/classify  — classify a user utterance into an intent
 * POST /api/crew/extract   — extract structured booking data from free text (GPT-4o)
 * POST /api/crew/reason    — general reasoning / planning (Claude)
 *
 * These are lightweight multi-model endpoints — no Python server needed.
 * For the full three-agent pipeline (Darwin → Codex → Claw), run apps/crew/server.py.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { routeToModel, classifyIntent } from '../lib/modelRouter';

export const crewRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── POST /api/crew/classify ───────────────────────────────────────────────────

crewRouter.post('/classify', async (c) => {
  const { transcript } = await c.req.json<{ transcript: string }>();
  if (!transcript) return c.json({ error: 'transcript required' }, 400);

  const intent = await classifyIntent(c.env, transcript);
  return c.json({ intent });
});

// ── POST /api/crew/extract ────────────────────────────────────────────────────

crewRouter.post('/extract', async (c) => {
  const { text, fields } = await c.req.json<{ text: string; fields?: string[] }>();
  if (!text) return c.json({ error: 'text required' }, 400);

  const wantedFields = fields ?? [
    'trainNumber', 'from', 'to', 'departureTime', 'arrivalTime',
    'fare', 'currency', 'class', 'operator',
  ];

  const { model, output } = await routeToModel(
    c.env,
    'extract',
    `Extract travel booking details as JSON. Return only a JSON object with these fields: ${wantedFields.join(', ')}. Set missing fields to null. No explanation.`,
    text,
    { maxTokens: 512 },
  );

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(output.replace(/^```json\n?/, '').replace(/\n?```$/, ''));
  } catch {
    parsed = { raw: output };
  }

  return c.json({ model, data: parsed });
});

// ── POST /api/crew/reason ─────────────────────────────────────────────────────

crewRouter.post('/reason', async (c) => {
  const { system, user, maxTokens } = await c.req.json<{
    system: string;
    user: string;
    maxTokens?: number;
  }>();
  if (!system || !user) return c.json({ error: 'system and user required' }, 400);

  const { model, output } = await routeToModel(c.env, 'reason', system, user, { maxTokens });
  return c.json({ model, output });
});
