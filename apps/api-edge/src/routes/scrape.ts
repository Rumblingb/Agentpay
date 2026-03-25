import { Hono } from 'hono';
import type { Env, Variables } from '../types';

export const scrapeRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

interface ScrapeRequestBody {
  url?: string;
  prompt?: string;
}

interface FirecrawlResponse {
  data?: {
    markdown?: string;
    metadata?: {
      sourceURL?: string;
      url?: string;
    };
  };
}

scrapeRouter.post('/', async (c) => {
  if (c.env.BRO_CLIENT_KEY) {
    const clientKey = c.req.header('x-bro-key') ?? '';
    if (clientKey !== c.env.BRO_CLIENT_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  if (!c.env.FIRECRAWL_API_KEY) {
    return c.json({ error: 'Firecrawl not configured' }, 503);
  }

  let body: ScrapeRequestBody;
  try {
    body = await c.req.json<ScrapeRequestBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const url = body.url?.trim();
  const prompt = body.prompt?.trim();
  if (!url || !prompt) {
    return c.json({ error: 'url and prompt required' }, 400);
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return c.json({ error: errorText || `Firecrawl error ${response.status}` }, 502);
    }

    const payload = await response.json() as FirecrawlResponse;
    const markdown = payload.data?.markdown?.trim();
    if (!markdown) {
      return c.json({ error: 'No markdown returned' }, 502);
    }

    return c.json({
      markdown,
      url: payload.data?.metadata?.sourceURL ?? payload.data?.metadata?.url ?? url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scrape failed';
    return c.json({ error: message }, 500);
  }
});
