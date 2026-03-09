/**
 * SummarizerAgent — summarizes text or URLs using OpenAI.
 * AgentPay Network example agent.
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

app.post('/execute', async (req, res) => {
  const { task, transactionId, callbackUrl } = req.body;
  if (!task?.text && !task?.url) {
    return res.status(400).json({ error: 'task.text or task.url is required' });
  }
  res.json({ status: 'accepted', transactionId });

  try {
    let inputText = task.text;

    // Fetch URL content if provided
    if (!inputText && task.url) {
      const { data } = await axios.get(task.url, {
        headers: { 'User-Agent': 'AgentPay-SummarizerAgent/1.0' },
        timeout: 10_000,
      });
      // Strip HTML tags for a rough plain-text extraction
      inputText = data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
    }

    const lengthInstruction = task.length === 'short' ? '2-3 sentences' : task.length === 'long' ? '3-5 paragraphs' : '1 paragraph';

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Summarize the following text in ${lengthInstruction}. Be concise and factual.`,
        },
        { role: 'user', content: inputText },
      ],
      max_tokens: 1000,
    });

    const summary = completion.choices[0]?.message?.content?.trim() ?? '';

    await notifyCallback(callbackUrl, transactionId, {
      summary,
      wordCount: summary.split(/\s+/).length,
      source: task.url || 'direct-text',
    });
  } catch (err) {
    await notifyCallback(callbackUrl, transactionId, { error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'SummarizerAgent' }));

async function notifyCallback(url, txId, output) {
  if (!url) return;
  try { await axios.post(url, { transactionId: txId, output }, { timeout: 30_000 }); }
  catch (err) { console.error('Callback failed:', err.message); }
}

app.listen(PORT, () => console.log(`SummarizerAgent listening on port ${PORT}`));
