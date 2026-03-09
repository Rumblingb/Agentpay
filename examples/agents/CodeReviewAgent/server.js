/**
 * CodeReviewAgent — reviews code for bugs, style, and security issues.
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
  if (!task?.code) {
    return res.status(400).json({ error: 'task.code is required' });
  }
  res.json({ status: 'accepted', transactionId });

  try {
    const language = task.language || 'unknown';
    const focus = task.focus || 'bugs, performance, security, and style';

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert code reviewer. Review the following ${language} code for ${focus}. Return a JSON object with: { issues: [{ severity, line?, description, suggestion }], summary, score (0-10) }`,
        },
        { role: 'user', content: `\`\`\`${language}\n${task.code}\n\`\`\`` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
    });

    let review;
    try {
      review = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
    } catch {
      review = { summary: completion.choices[0]?.message?.content, issues: [] };
    }

    await notifyCallback(callbackUrl, transactionId, {
      ...review,
      language,
      linesReviewed: task.code.split('\n').length,
    });
  } catch (err) {
    await notifyCallback(callbackUrl, transactionId, { error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'CodeReviewAgent' }));

async function notifyCallback(url, txId, output) {
  if (!url) return;
  try { await axios.post(url, { transactionId: txId, output }, { timeout: 30_000 }); }
  catch (err) { console.error('Callback failed:', err.message); }
}

app.listen(PORT, () => console.log(`CodeReviewAgent listening on port ${PORT}`));
