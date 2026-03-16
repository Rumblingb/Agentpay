/**
 * API Documentation route — serves Swagger UI for the AgentPay OpenAPI spec.
 * Mount at: /api/docs
 *
 * Serves:
 *   GET /api/docs       — Swagger UI (HTML)
 *   GET /api/docs/spec  — openapi.yaml (raw)
 *
 * @module routes/apiDocs
 */

import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

const router = Router();
const OPENAPI_PATH = join(process.cwd(), 'openapi.yaml');

/** GET /api/docs — Swagger UI */
router.get('/', (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentPay API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0d1117; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs/spec',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      displayRequestDuration: true,
    });
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/** GET /api/docs/spec — raw OpenAPI YAML */
router.get('/spec', (_req: Request, res: Response) => {
  try {
    const spec = readFileSync(OPENAPI_PATH, 'utf-8');
    res.setHeader('Content-Type', 'application/yaml');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(spec);
  } catch {
    res.status(404).json({ error: 'OpenAPI spec not found' });
  }
});

export default router;
