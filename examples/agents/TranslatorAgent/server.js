/**
 * TranslatorAgent — translates text using OpenAI.
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
  if (!task?.text || !task?.targetLanguage) {
    return res.status(400).json({ error: 'task.text and task.targetLanguage are required' });
  }
  res.json({ status: 'accepted', transactionId });

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${task.targetLanguage}. Return only the translated text with no explanations.`,
        },
        { role: 'user', content: task.text },
      ],
      max_tokens: 2000,
    });

    const translated = completion.choices[0]?.message?.content?.trim() ?? '';

    await notifyCallback(callbackUrl, transactionId, {
      original: task.text,
      translated,
      sourceLanguage: task.sourceLanguage || 'auto',
      targetLanguage: task.targetLanguage,
    });
  } catch (err) {
    await notifyCallback(callbackUrl, transactionId, { error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'TranslatorAgent' }));

async function notifyCallback(url, txId, output) {
  if (!url) return;
  try { await axios.post(url, { transactionId: txId, output }, { timeout: 30_000 }); }
  catch (err) { console.error('Callback failed:', err.message); }
}

app.listen(PORT, () => console.log(`TranslatorAgent listening on port ${PORT}`));
