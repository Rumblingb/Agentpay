const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

let invoices = [];
let webhooks = [];

function pushWebhook(event, invoiceId, payload){
  webhooks.push({ id: uuidv4(), event, invoiceId, payload, timestamp: Date.now() });
}

app.get('/api/invoices', (req, res) => {
  res.json(invoices);
});

app.post('/api/invoices', (req, res) => {
  const { patient, amount, code } = req.body;
  const id = uuidv4();
  const inv = { id, patient: patient || 'Unknown', amount: Number(amount||0), code: code||null, status: 'draft', errors: [] };
  invoices.push(inv);
  res.json({ success: true, id, message: 'Invoice created', invoice: inv });
});

app.post('/api/invoices/:id/submit', (req, res) => {
  const id = req.params.id;
  const inv = invoices.find(i => i.id === id);
  if (!inv) return res.status(404).json({ error: 'not found' });

  // basic validation: amount > 0 and code present
  inv.errors = [];
  if (!inv.code) inv.errors.push('missing_code');
  if (!inv.amount || inv.amount <= 0) inv.errors.push('invalid_amount');

  if (inv.errors.length) {
    inv.status = 'denied';
    pushWebhook('invoice.submission_failed', id, { errors: inv.errors });
    return res.json({ success: false, status: inv.status, errors: inv.errors });
  }

  inv.status = 'submitted';
  pushWebhook('invoice.submitted', id, { amount: inv.amount });
  return res.json({ success: true, status: inv.status });
});

app.post('/api/invoices/:id/simulatePay', (req, res) => {
  const id = req.params.id;
  const inv = invoices.find(i => i.id === id);
  if (!inv) return res.status(404).json({ error: 'not found' });
  inv.status = 'paid';
  pushWebhook('invoice.paid', id, { amount: inv.amount });
  res.json({ success: true, status: inv.status });
});

app.post('/api/invoices/:id/fix', (req, res) => {
  const id = req.params.id;
  const inv = invoices.find(i => i.id === id);
  if (!inv) return res.status(404).json({ error: 'not found' });
  inv.errors = [];
  inv.status = 'draft';
  pushWebhook('invoice.fixed', id, {});
  res.json({ success: true, status: inv.status });
});

app.get('/api/inbox', (req, res) => {
  const items = invoices.filter(i => i.status === 'denied');
  res.json(items);
});

app.get('/api/webhooks', (req, res) => {
  res.json(webhooks);
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('Mock server listening on', port));
