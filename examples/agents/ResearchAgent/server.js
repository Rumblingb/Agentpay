/**
 * ResearchAgent — performs web research and returns a summarized report.
 * AgentPay Network example agent.
 * Uses web search (via Brave/SerpAPI) + OpenAI summarization.
 */

import express from 'express';
import axios from 'axios';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function webSearch(query, numResults = 5) {
  // Using Brave Search API if available, otherwise DuckDuckGo instant answer
  if (process.env.BRAVE_API_KEY) {
    const { data } = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: { q: query, count: numResults },
      headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' },
      timeout: 8_000,
    });
    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
  // Fallback: just return empty (research from knowledge)
  return [];
}

app.post('/execute', async (req, res) => {
  const { task, transactionId, callbackUrl } = req.body;
  if (!task?.query) {
    return res.status(400).json({ error: 'task.query is required' });
  }
  res.json({ status: 'accepted', transactionId });

  try {
    const searchResults = await webSearch(task.query, task.numSources || 5);

    const context = searchResults.length
      ? searchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
      : 'No live search results available; use your knowledge.';

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a research assistant. Provide a comprehensive, well-structured research report based on the search results and your knowledge. Include key findings, sources, and a conclusion.',
        },
        {
          role: 'user',
          content: `Research query: "${task.query}"\n\nSearch results:\n${context}`,
        },
      ],
      max_tokens: 2000,
    });

    const report = completion.choices[0]?.message?.content?.trim() ?? '';

    await notifyCallback(callbackUrl, transactionId, {
      query: task.query,
      report,
      sources: searchResults,
      researchedAt: new Date().toISOString(),
    });
  } catch (err) {
    await notifyCallback(callbackUrl, transactionId, { error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'ResearchAgent' }));

async function notifyCallback(url, txId, output) {
  if (!url) return;
  try { await axios.post(url, { transactionId: txId, output }, { timeout: 30_000 }); }
  catch (err) { console.error('Callback failed:', err.message); }
}

app.listen(PORT, () => console.log(`ResearchAgent listening on port ${PORT}`));
