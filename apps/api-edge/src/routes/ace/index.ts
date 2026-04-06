/**
 * Ace router — mounts all /ace/* sub-routes.
 *
 * Route map:
 *   POST   /ace/principals                      → create principal
 *   GET    /ace/principals/:id                  → get principal
 *   GET    /ace/principals/:id/policy           → get policy
 *   PATCH  /ace/principals/:id/policy           → update policy
 *
 *   POST   /ace/operators                       → register operator
 *   GET    /ace/operators/:id                   → get operator
 *   DELETE /ace/operators/:id                   → revoke operator
 *
 *   POST   /ace/intents                         → submit intent
 *   GET    /ace/intents/:id                     → get intent
 *   POST   /ace/intents/:id/plan                → run planner
 *   POST   /ace/intents/:id/approve             → approve/reject
 *   POST   /ace/intents/:id/execute             → execute
 *
 *   GET    /ace/journeys/:id                    → get live journey
 *   PATCH  /ace/journeys/:id/live               → update live state (internal)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { acePrincipalsRouter } from './principals';
import { aceOperatorsRouter } from './operators';
import { aceIntentsRouter } from './intents';
import { acePlanRouter } from './plan';
import { aceApproveRouter } from './approve';
import { aceExecuteRouter } from './execute';
import { aceJourneysRouter } from './journeys';

const aceRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

aceRouter.route('/principals', acePrincipalsRouter);
aceRouter.route('/operators', aceOperatorsRouter);
aceRouter.route('/intents', aceIntentsRouter);
aceRouter.route('/intents/:id/plan', acePlanRouter);
aceRouter.route('/intents/:id/approve', aceApproveRouter);
aceRouter.route('/intents/:id/execute', aceExecuteRouter);
aceRouter.route('/journeys/:id', aceJourneysRouter);

export { aceRouter };
