/**
 * ImageGenAgent — generates images via OpenAI DALL-E.
 * AgentPay Network example agent.
 *
 * Deploy: agentpay deploy --name ImageGenAgent --service image-generation --endpoint https://your-domain/execute
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

  if (!task?.prompt) {
    return res.status(400).json({ error: 'task.prompt is required' });
  }

  res.json({ status: 'accepted', transactionId });

  try {
    const response = await client.images.generate({
      model: task.model || 'dall-e-3',
      prompt: task.prompt,
      size: task.size || '1024x1024',
      quality: task.quality || 'standard',
      n: 1,
    });

    await notifyCallback(callbackUrl, transactionId, {
      imageUrl: response.data[0].url,
      revisedPrompt: response.data[0].revised_prompt,
      prompt: task.prompt,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    await notifyCallback(callbackUrl, transactionId, { error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'ImageGenAgent' }));

async function notifyCallback(callbackUrl, transactionId, output) {
  if (!callbackUrl) return;
  try {
    await axios.post(callbackUrl, { transactionId, output }, { timeout: 30_000 });
  } catch (err) {
    console.error('Callback failed:', err.message);
  }
}

app.listen(PORT, () => console.log(`ImageGenAgent listening on port ${PORT}`));
