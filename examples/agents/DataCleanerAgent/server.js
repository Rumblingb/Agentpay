/**
 * DataCleanerAgent — normalizes CSV or JSON data.
 * AgentPay Network example agent.
 */

import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '5mb' }));
const PORT = process.env.PORT || 3000;

/**
 * Clean/normalize a CSV string.
 * - Trims whitespace from all cells
 * - Normalizes empty cells to null
 * - Removes duplicate rows
 * - Returns parsed array + stats
 */
function cleanCsv(csvString) {
  const lines = csvString.trim().split(/\r?\n/);
  if (lines.length === 0) return { rows: [], stats: {} };

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = {};
    headers.forEach((h, j) => {
      const val = cells[j]?.trim();
      row[h] = val === '' || val === undefined ? null : val;
    });
    const key = JSON.stringify(row);
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
  }

  return {
    rows,
    stats: {
      totalRows: rows.length,
      duplicatesRemoved: lines.length - 1 - rows.length,
      columns: headers,
    },
  };
}

/**
 * Clean/normalize a JSON array of objects.
 */
function cleanJson(data) {
  if (!Array.isArray(data)) {
    if (typeof data === 'object' && data !== null) {
      data = [data];
    } else {
      throw new Error('Input must be a JSON array or object');
    }
  }

  const seen = new Set();
  const cleaned = [];

  for (const item of data) {
    const normalized = {};
    for (const [key, value] of Object.entries(item)) {
      const cleanKey = key.trim().toLowerCase().replace(/\s+/g, '_');
      // Normalize values
      if (value === '' || value === undefined) {
        normalized[cleanKey] = null;
      } else if (typeof value === 'string') {
        normalized[cleanKey] = value.trim();
      } else {
        normalized[cleanKey] = value;
      }
    }
    const key = JSON.stringify(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(normalized);
    }
  }

  return {
    rows: cleaned,
    stats: {
      totalRows: cleaned.length,
      duplicatesRemoved: data.length - cleaned.length,
      columns: cleaned[0] ? Object.keys(cleaned[0]) : [],
    },
  };
}

app.post('/execute', async (req, res) => {
  const { task, transactionId, callbackUrl } = req.body;
  if (!task?.data) {
    return res.status(400).json({ error: 'task.data is required (CSV string or JSON array)' });
  }
  res.json({ status: 'accepted', transactionId });

  try {
    let result;

    if (task.format === 'csv' || typeof task.data === 'string') {
      result = cleanCsv(task.data);
    } else {
      result = cleanJson(task.data);
    }

    await notifyCallback(callbackUrl, transactionId, {
      ...result,
      format: task.format || 'json',
      cleanedAt: new Date().toISOString(),
    });
  } catch (err) {
    await notifyCallback(callbackUrl, transactionId, { error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'DataCleanerAgent' }));

async function notifyCallback(url, txId, output) {
  if (!url) return;
  try { await axios.post(url, { transactionId: txId, output }, { timeout: 30_000 }); }
  catch (err) { console.error('Callback failed:', err.message); }
}

app.listen(PORT, () => console.log(`DataCleanerAgent listening on port ${PORT}`));
