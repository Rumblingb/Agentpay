#!/usr/bin/env node
// Minimal local startup helper for smoke tests.
// Imports the built app (dist/server.js) and calls `listen()` so the HTTP
// surface is bound for local verification without changing production code.
import path from 'path';
import { pathToFileURL } from 'url';

const distPath = path.resolve(process.cwd(), 'dist', 'server.js');

try {
  const mod = await import(pathToFileURL(distPath).href);
  const app = mod?.default ?? mod.app ?? mod;
  if (!app || typeof app.listen !== 'function') {
    console.error('Imported module does not export an Express app with listen().');
    process.exit(1);
  }

  const port = Number(process.env.PORT) || 3003;
  app.listen(port, () => {
    console.log(`AgentPay (local-start) listening on http://localhost:${port}`);
  });
} catch (err) {
  console.error('Failed to import or start dist/server.js', err);
  process.exit(1);
}
