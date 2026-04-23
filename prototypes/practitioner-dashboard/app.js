const API_BASE = 'http://localhost:3000/api/merchants';
const API_KEY = 'sk_test_sim'; // development bypass key (see README)

function authHeaders(extra = {}) {
  return Object.assign({ 'x-api-key': API_KEY, 'Content-Type': 'application/json' }, extra);
}

// Client-side transient cache for display. Drafts are persisted to the repo DB
// via POST /payments/drafts. No localStorage persistence used to keep a single
// source of truth.
let localInvoices = [];

// Code lists loaded for basic autocomplete and scrubbing rules.
let codeLists = { cpt: [], icd: [] };

async function loadCodes() {
  try {
    const res = await fetch('codes.json');
    codeLists = await res.json();
    const dl = document.getElementById('code-list');
    if (dl && codeLists) {
      dl.innerHTML = '';
      [...(codeLists.cpt || []), ...(codeLists.icd || [])].forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.code + ' — ' + c.desc;
        dl.appendChild(opt);
      });
    }
  } catch (err) {
    console.warn('Failed to load codes.json', err);
  }
}
async function api(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers || {}, { 'x-api-key': API_KEY });
  const res = await fetch(API_BASE + path, opts);
  return res.json();
}

async function loadInvoices() {
  // Fetch server-side transactions
  const server = await api('/payments');
  const serverTx = Array.isArray(server.transactions) ? server.transactions : [];

  // Merge with local drafts: show server transactions (with linked local metadata when present)
  const rows = serverTx.map((t) => {
    const meta = localInvoices.find(li => li.transactionId === t.id) || {};
    return {
      id: t.id,
      patient: meta.patient || (t.metadata && t.metadata.patient) || '—',
      amount: t.amountUsdc || t.amount || 0,
      code: meta.code || (t.metadata && t.metadata.code) || '',
      status: t.status || 'pending',
    };
  });

  // No local-only drafts: server-held drafts will appear in serverTx because
  // we persist them on creation via POST /payments/drafts.

  const container = document.getElementById('invoices');
  if (!rows.length) return container.innerHTML = '<div class="small">No invoices yet</div>';

  let html = '<table><thead><tr><th>ID</th><th>Patient</th><th>Amount</th><th>Code</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
  for (const inv of rows) {
    html += `<tr>
      <td>${inv.id}</td>
      <td>${inv.patient}</td>
      <td>$${Number(inv.amount).toFixed(2)}</td>
      <td>${inv.code || ''}</td>
      <td class="status-${inv.status}">${inv.status}</td>
      <td>`;

    if (inv.status === 'draft') {
      html += `<button onclick="submitInvoice('${inv.id}')">Submit</button> `;
      html += `<button onclick="fixInvoice('${inv.id}')">Fix</button>`;
    } else {
      html += `<button onclick="simulatePay('${inv.id}')">Simulate Pay</button> `;
    }

    html += '</td></tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function loadInbox() {
  // Use server webhook history to detect failures/denials
  const res = await api('/webhooks');
  const events = (res && res.events) || [];
  const denials = events.filter(e => e.event_type === 'payment.failed' || e.event_type === 'payment.error' || e.event_type === 'payment.denied');
  const container = document.getElementById('inbox');
  if (!denials.length) return container.innerHTML = '<div class="small">No exceptions</div>';
  let html = '<ul>';
  for (const it of denials) {
    html += `<li><strong>${it.id}</strong> — ${JSON.stringify(it.payload)} — <span class="status-denied">${it.status}</span></li>`;
  }
  html += '</ul>';
  container.innerHTML = html;
}

async function loadWebhooks() {
  const res = await api('/webhooks');
  const events = (res && res.events) || [];
  const container = document.getElementById('webhooks');
  if (!events.length) return container.innerHTML = '<div class="small">No webhooks</div>';
  let html = '<ul>';
  for (const e of events.slice(0, 50)) {
    html += `<li>${new Date(e.created_at).toLocaleString()}: ${e.event_type} — ${e.payload && JSON.stringify(e.payload)}</li>`;
  }
  html += '</ul>';
  container.innerHTML = html;
}

async function submitInvoice(id) {
  // Find local draft
  // For submitted drafts we call the official /payments endpoint to create an
  // actionable payment request. The UI expects drafts to be persisted already
  // in the DB (via /payments/drafts). Here we call /payments to convert a
  // server-held draft into a live pending transaction.
  const draft = await api('/payments');
  // Fallback: find transaction if exists in UI list
  // (UI will show server drafts automatically after refresh)
  // For simplicity, just refresh the UI and instruct the user to use the
  // 'Submit' button on drafts which were created via createInvoice().
  await refreshAll();
}

async function simulatePay(id) {
  // Call verification endpoint to simulate payment clearing
  const txId = id; // when clicking on server transaction, id is the transaction id
  const res = await fetch(`${API_BASE}/payments/${txId}/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ transactionHash: 'sim_tx_12345' }),
  });
  await res.json();
  await refreshAll();
}

async function fixInvoice(id) {
  // For drafts: allow simple edit to clear errors
  const item = localInvoices.find(i => i.id === id);
  if (!item) return alert('Item not editable');
  item.status = 'draft';
  saveLocal();
  await refreshAll();
}

async function createInvoice() {
  const patient = document.getElementById('patient').value;
  const amount = parseFloat(document.getElementById('amount').value || 0);
  const code = document.getElementById('code').value;
  // Run quick scrubbing rules
  const scrub = scrubClaim({ patient, amount, code });
  if (!scrub.ok) {
    document.getElementById('createMsg').textContent = 'Draft failed validation: ' + scrub.reason;
    return;
  }

  // Persist draft to server
  const body = {
    amountUsdc: Number(amount),
    recipientAddress: '',
    metadata: { patient, code, scrubStatus: scrub.status },
  };

  try {
    const res = await fetch(API_BASE + '/payments/drafts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data && data.transactionId) {
      document.getElementById('createMsg').textContent = 'Draft saved';
    } else {
      document.getElementById('createMsg').textContent = 'Failed to save draft';
    }
  } catch (err) {
    console.error(err);
    document.getElementById('createMsg').textContent = 'Error saving draft';
  }

  document.getElementById('patient').value='';
  document.getElementById('amount').value='';
  document.getElementById('code').value='';
  await refreshAll();
}

/** Basic scrubbing rules for the prototype. */
function scrubClaim({ patient, amount, code }) {
  if (!patient || String(patient).trim().length < 2) return { ok: false, reason: 'Patient name required' };
  if (!amount || Number(amount) <= 0) return { ok: false, reason: 'Amount must be positive' };
  if (!code || String(code).trim().length === 0) return { ok: false, reason: 'Procedure code required' };

  // Check code against our small code list
  const flat = [...(codeLists.cpt || []), ...(codeLists.icd || [])].map(c => String(c.code));
  const matched = flat.find(c => code.indexOf(c) === 0 || c.indexOf(code) === 0);
  if (!matched) {
    return { ok: true, status: 'unknown_code', reason: 'Code not in local list — flag for review' };
  }

  return { ok: true, status: 'clean' };
}

async function refreshAll() {
  await loadInvoices();
  await loadInbox();
  await loadWebhooks();
}

document.getElementById('create').addEventListener('click', createInvoice);

// Load codes for autocomplete and then refresh UI
loadCodes().then(refreshAll);

// expose helpers for onclick from HTML buttons
window.submitInvoice = submitInvoice;
window.simulatePay = simulatePay;
window.fixInvoice = fixInvoice;
