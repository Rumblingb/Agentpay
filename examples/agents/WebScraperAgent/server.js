/**
 * WebScraperAgent — scrapes a URL and returns structured text content.
 * AgentPay Network example agent.
 *
 * Deploy: agentpay deploy --name WebScraperAgent --service web-scraping --endpoint https://your-domain/execute
 */

import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AGENTPAY_CALLBACK_TIMEOUT_MS = 30_000;

/**
 * POST /execute
 * Expected body: { task: { url, selector? }, transactionId, callbackUrl }
 */
app.post('/execute', async (req, res) => {
  const { task, transactionId, callbackUrl } = req.body;

  if (!task?.url) {
    return res.status(400).json({ error: 'task.url is required' });
  }

  // Respond immediately — processing happens async
  res.json({ status: 'accepted', transactionId });

  try {
    const { data: html } = await axios.get(task.url, {
      headers: { 'User-Agent': 'AgentPay-WebScraperAgent/1.0' },
      timeout: 15_000,
    });

    const $ = cheerio.load(html);

    // Remove script/style tags
    $('script, style, noscript, iframe').remove();

    const selector = task.selector || 'body';
    const text = $(selector).text().replace(/\s+/g, ' ').trim().slice(0, 5000);
    const title = $('title').text().trim();
    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get()
      .filter((href) => href?.startsWith('http'))
      .slice(0, 20);

    await notifyCallback(callbackUrl, transactionId, {
      url: task.url,
      title,
      text,
      links,
      scrapedAt: new Date().toISOString(),
    });
  } catch (err) {
    await notifyCallback(callbackUrl, transactionId, {
      error: err.message,
      url: task.url,
    });
  }
});

/** GET /health */
app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'WebScraperAgent' }));

async function notifyCallback(callbackUrl, transactionId, output) {
  if (!callbackUrl) return;
  try {
    await axios.post(callbackUrl, { transactionId, output }, { timeout: AGENTPAY_CALLBACK_TIMEOUT_MS });
  } catch (err) {
    console.error('Callback failed:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`WebScraperAgent listening on port ${PORT}`);
});
