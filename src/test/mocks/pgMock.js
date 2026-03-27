const state = global.__AGENTPAY_PG_MOCK__ || (global.__AGENTPAY_PG_MOCK__ = {
  tables: {
    merchants: [],
    transactions: [],
    bots: [],
    webhook_events: [],
    payment_audit_log: [],
    agent_reputation: [],
    merchant_invoices: [],
    verification_certificates: [],
    payment_verifications: [],
    rate_limit_counters: [],
    api_logs: [],
  },
  counters: {
    webhook_events: 1,
    merchant_invoices: 1,
    verification_certificates: 1,
  },
});

function now() {
  return new Date();
}

function cloneRow(row) {
  return JSON.parse(JSON.stringify(row));
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function callbackOrPromise(result, cb) {
  if (typeof cb === 'function') {
    setImmediate(() => cb(null, result));
    return;
  }
  return Promise.resolve(result);
}

function callbackError(err, cb) {
  if (typeof cb === 'function') {
    setImmediate(() => cb(err));
    return;
  }
  return Promise.reject(err);
}

function ok(rows = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function tableExists(name) {
  return Object.prototype.hasOwnProperty.call(state.tables, name);
}

function nextId(prefix) {
  const current = state.counters[prefix] || 1;
  state.counters[prefix] = current + 1;
  return `${prefix}-${current}`;
}

function handleQuery(sql, params = []) {
  const normalized = normalizeSql(sql);

  if (normalized.includes('from information_schema.tables where table_name = $1')) {
    const table = params[0];
    return ok([{ exists: tableExists(table) }], 1);
  }

  if (normalized.startsWith('truncate ')) {
    const match = normalized.match(/^truncate\s+([a-z_]+)/);
    const table = match ? match[1] : null;
    if (table && tableExists(table)) {
      state.tables[table] = [];
    }
    return ok([], 0);
  }

  if (normalized.startsWith('insert into merchants')) {
    const [id, name, email, apiKeyHash, apiKeySalt, keyPrefix, walletAddress, webhookUrl, isActive] = params;
    const duplicate = state.tables.merchants.find(
      (merchant) => merchant.email === email || merchant.wallet_address === walletAddress
    );
    if (duplicate) {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    }
    state.tables.merchants.push({
      id,
      name,
      email,
      api_key_hash: apiKeyHash,
      api_key_salt: apiKeySalt,
      key_prefix: keyPrefix,
      wallet_address: walletAddress,
      webhook_url: webhookUrl,
      is_active: Boolean(isActive),
      created_at: now().toISOString(),
      updated_at: now().toISOString(),
      total_volume: 0,
      stripe_connected_account_id: null,
    });
    return ok([], 1);
  }

  if (normalized.includes('from merchants where key_prefix = $1 and is_active = true')) {
    const keyPrefix = params[0];
    const rows = state.tables.merchants
      .filter((merchant) => merchant.key_prefix === keyPrefix && merchant.is_active)
      .map((merchant) => ({
        id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        walletAddress: merchant.wallet_address,
        webhookUrl: merchant.webhook_url,
        createdAt: merchant.created_at,
        apiKeyHash: merchant.api_key_hash,
        apiKeySalt: merchant.api_key_salt,
      }));
    return ok(rows);
  }

  if (normalized.includes('from merchants where id = $1')) {
    const merchantId = params[0];
    const merchant = state.tables.merchants.find((row) => row.id === merchantId);
    if (!merchant) return ok([], 0);

    if (normalized.includes('select webhook_url as "webhookurl"')) {
      return ok([{ webhookUrl: merchant.webhook_url }], 1);
    }

    if (normalized.includes('select stripe_connected_account_id')) {
      return ok([{ stripe_connected_account_id: merchant.stripe_connected_account_id }], 1);
    }

    return ok([{
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      walletAddress: merchant.wallet_address,
      webhookUrl: merchant.webhook_url,
      createdAt: merchant.created_at,
    }], 1);
  }

  if (normalized.startsWith('update merchants set webhook_url = $1')) {
    const [webhookUrl, merchantId] = params;
    const merchant = state.tables.merchants.find((row) => row.id === merchantId);
    if (!merchant) return ok([], 0);
    merchant.webhook_url = webhookUrl;
    merchant.updated_at = now().toISOString();
    return ok([], 1);
  }

  if (normalized.startsWith('update merchants set api_key_hash = $1')) {
    const [apiKeyHash, apiKeySalt, keyPrefix, merchantId] = params;
    const merchant = state.tables.merchants.find((row) => row.id === merchantId && row.is_active);
    if (!merchant) return ok([], 0);
    merchant.api_key_hash = apiKeyHash;
    merchant.api_key_salt = apiKeySalt;
    merchant.key_prefix = keyPrefix;
    merchant.updated_at = now().toISOString();
    return ok([], 1);
  }

  if (normalized.startsWith('update merchants set total_volume = coalesce(total_volume, 0) + $1')) {
    const [delta, merchantId] = params;
    const merchant = state.tables.merchants.find((row) => row.id === merchantId);
    if (!merchant) return ok([], 0);
    merchant.total_volume = Number(merchant.total_volume || 0) + Number(delta || 0);
    merchant.updated_at = now().toISOString();
    return ok([], 1);
  }

  if (normalized.startsWith('update merchants set stripe_connected_account_id = $1')) {
    const [accountId, merchantId] = params;
    const merchant = state.tables.merchants.find((row) => row.id === merchantId);
    if (!merchant) return ok([], 0);
    merchant.stripe_connected_account_id = accountId;
    merchant.updated_at = now().toISOString();
    return ok([], 1);
  }

  if (normalized.startsWith('insert into transactions')) {
    const [id, merchantId, paymentId, amountUsdc, recipientAddress, status, confirmationDepth, requiredDepth, expiresAt, createdAt] = params;
    state.tables.transactions.push({
      id,
      merchant_id: merchantId,
      payment_id: paymentId,
      amount_usdc: Number(amountUsdc),
      recipient_address: recipientAddress,
      payer_address: null,
      transaction_hash: null,
      status,
      confirmation_depth: Number(confirmationDepth),
      required_depth: Number(requiredDepth),
      expires_at: new Date(expiresAt).toISOString(),
      created_at: new Date(createdAt).toISOString(),
      updated_at: new Date(createdAt).toISOString(),
      stripe_payment_reference: null,
    });
    return ok([], 1);
  }

  if (normalized.startsWith('insert into bots')) {
    const [
      platformBotId,
      handle,
      displayName,
      bio,
      createdBy,
      primaryFunction,
      walletAddress,
      walletKeypairEncrypted,
      dailySpendingLimit,
      perTxLimit,
      autoApproveUnder,
      dailyAutoApproveCap,
      id,
    ] = params;
    const duplicate = state.tables.bots.find(
      (bot) => bot.handle === handle || bot.platform_bot_id === platformBotId
    );
    if (duplicate) {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    }
    const row = {
      id,
      platform_bot_id: platformBotId,
      handle,
      display_name: displayName,
      bio,
      created_by: createdBy,
      primary_function: primaryFunction,
      wallet_address: walletAddress,
      wallet_keypair_encrypted: walletKeypairEncrypted,
      daily_spending_limit: Number(dailySpendingLimit),
      per_tx_limit: Number(perTxLimit),
      auto_approve_under: Number(autoApproveUnder),
      daily_auto_approve_cap: Number(dailyAutoApproveCap),
      require_pin_above: null,
      alert_webhook_url: null,
      pin_hash: null,
      balance_usdc: 0,
      total_earned: 0,
      total_spent: 0,
      total_tips_received: 0,
      reputation_score: 0,
      tips_received_count: 0,
      total_transactions: 0,
      successful_transactions: 0,
      disputed_transactions: 0,
      status: 'active',
      created_at: now().toISOString(),
      updated_at: now().toISOString(),
    };
    state.tables.bots.push(row);
    return ok([{
      id: row.id,
      platform_bot_id: row.platform_bot_id,
      handle: row.handle,
      wallet_address: row.wallet_address,
    }], 1);
  }

  if (normalized.includes('from bots where id = $1 or platform_bot_id = $1 limit 1')) {
    const botId = params[0];
    const row = state.tables.bots.find((bot) => bot.id === botId || bot.platform_bot_id === botId);
    return ok(row ? [{ id: row.id }] : [], row ? 1 : 0);
  }

  if (normalized.includes('from bots where id = $1')) {
    const botId = params[0];
    const row = state.tables.bots.find((bot) => bot.id === botId);
    return ok(row ? [cloneRow(row)] : [], row ? 1 : 0);
  }

  if (normalized.includes('from transactions where id = $1')) {
    const transactionId = params[0];
    const tx = state.tables.transactions.find((row) => row.id === transactionId);
    if (!tx) return ok([], 0);

    if (normalized.includes('select payment_id as "paymentintentid"')) {
      return ok([{ paymentIntentId: tx.payment_id }], 1);
    }

    return ok([{
      id: tx.id,
      merchantId: tx.merchant_id,
      paymentId: tx.payment_id,
      amountUsdc: tx.amount_usdc,
      recipientAddress: tx.recipient_address,
      payerAddress: tx.payer_address,
      transactionHash: tx.transaction_hash,
      status: tx.status,
      confirmationDepth: tx.confirmation_depth,
      requiredDepth: tx.required_depth,
      expiresAt: tx.expires_at,
      createdAt: tx.created_at,
    }], 1);
  }

  if (normalized.includes('from transactions where merchant_id = $1 order by created_at desc limit $2 offset $3')) {
    const [merchantId, limit, offset] = params;
    const rows = state.tables.transactions
      .filter((tx) => tx.merchant_id === merchantId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(Number(offset), Number(offset) + Number(limit))
      .map((tx) => ({
        id: tx.id,
        merchantId: tx.merchant_id,
        paymentId: tx.payment_id,
        amountUsdc: tx.amount_usdc,
        recipientAddress: tx.recipient_address,
        payerAddress: tx.payer_address,
        transactionHash: tx.transaction_hash,
        status: tx.status,
        confirmationDepth: tx.confirmation_depth,
        requiredDepth: tx.required_depth,
        expiresAt: tx.expires_at,
        createdAt: tx.created_at,
      }));
    return ok(rows);
  }

  if (normalized.includes('from transactions where merchant_id = $1')) {
    const merchantId = params[0];
    const rows = state.tables.transactions.filter((tx) => tx.merchant_id === merchantId);
    const confirmed = rows.filter((tx) => ['confirmed', 'released'].includes(tx.status));
    const pending = rows.filter((tx) => tx.status === 'pending');
    const failed = rows.filter((tx) => tx.status === 'failed');
    return ok([{
      totalCount: String(rows.length),
      confirmedCount: String(confirmed.length),
      pendingCount: String(pending.length),
      failedCount: String(failed.length),
      totalConfirmedUsdc: String(confirmed.reduce((sum, tx) => sum + Number(tx.amount_usdc || 0), 0)),
    }], 1);
  }

  if (normalized.startsWith('update transactions set status = $1, updated_at = $2 where id = $3')) {
    const [status, updatedAt, transactionId] = params;
    const tx = state.tables.transactions.find((row) => row.id === transactionId);
    if (!tx) return ok([], 0);
    tx.status = status;
    tx.updated_at = new Date(updatedAt).toISOString();
    return ok([], 1);
  }

  if (normalized.startsWith('update transactions set status = $1, transaction_hash = $2')) {
    const [status, transactionHash, payerAddress, confirmationDepth, updatedAt, transactionId] = params;
    const tx = state.tables.transactions.find((row) => row.id === transactionId);
    if (!tx) return ok([], 0);
    tx.status = status;
    tx.transaction_hash = transactionHash;
    tx.payer_address = payerAddress;
    tx.confirmation_depth = Number(confirmationDepth);
    tx.updated_at = new Date(updatedAt).toISOString();
    return ok([], 1);
  }

  if (normalized.startsWith("update transactions set status = 'confirmed'")) {
    const [transactionHash, transactionId] = params;
    const tx = state.tables.transactions.find((row) => row.id === transactionId);
    if (!tx) return ok([], 0);
    tx.status = 'confirmed';
    tx.transaction_hash = transactionHash;
    tx.confirmation_depth = tx.required_depth;
    tx.updated_at = now().toISOString();
    return ok([], 1);
  }

  if (normalized.startsWith("update transactions set status = 'expired'")) {
    const tx = state.tables.transactions.find((row) => row.status === 'pending');
    if (tx) {
      tx.status = 'expired';
      tx.updated_at = now().toISOString();
    }
    return ok([], tx ? 1 : 0);
  }

  if (normalized.startsWith('insert into webhook_events')) {
    const [merchantId, eventType, transactionId, webhookUrl, payload, maxRetries] = params;
    const id = nextId('webhook_events');
    state.tables.webhook_events.push({
      id,
      merchant_id: merchantId,
      event_type: eventType,
      transaction_id: transactionId,
      webhook_url: webhookUrl,
      payload,
      status: 'pending',
      max_retries: Number(maxRetries),
      retry_count: 0,
      response_status: null,
      response_body: null,
      created_at: now().toISOString(),
      last_attempt_at: null,
    });
    return ok([{ id }], 1);
  }

  if (normalized.startsWith('update webhook_events set status = $1')) {
    const [status, retryCount, responseStatus, responseBody, eventId] = params;
    const event = state.tables.webhook_events.find((row) => row.id === eventId);
    if (!event) return ok([], 0);
    event.status = status;
    event.retry_count = Number(retryCount);
    event.response_status = responseStatus;
    event.response_body = responseBody;
    event.last_attempt_at = now().toISOString();
    return ok([], 1);
  }

  if (normalized.includes('from webhook_events where merchant_id = $1')) {
    const merchantId = params[0];
    let rows = state.tables.webhook_events.filter((row) => row.merchant_id === merchantId);
    if (normalized.includes("and status = 'sent'")) {
      rows = rows.filter((row) => row.status === 'sent');
    }
    rows = rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (normalized.includes('limit 1')) rows = rows.slice(0, 1);
    if (normalized.includes('limit 50')) rows = rows.slice(0, 50);
    return ok(rows.map((row) => cloneRow(row)));
  }

  if (normalized.startsWith('insert into payment_audit_log')) {
    const [merchantId, ipAddress, transactionSignature, transactionId, endpoint, method, succeeded, failureReason] = params;
    state.tables.payment_audit_log.push({
      merchant_id: merchantId,
      ip_address: ipAddress,
      transaction_signature: transactionSignature,
      transaction_id: transactionId,
      endpoint,
      method,
      succeeded,
      failure_reason: failureReason,
      created_at: now().toISOString(),
    });
    return ok([], 1);
  }

  if (normalized.startsWith('insert into agent_reputation')) {
    const [agentId, successRate, trustScore] = params;
    const row = {
      agent_id: agentId,
      total_payments: 1,
      success_rate: Number(successRate),
      trust_score: Number(trustScore),
      dispute_rate: 0,
      last_payment_at: now().toISOString(),
      created_at: now().toISOString(),
      updated_at: now().toISOString(),
    };
    state.tables.agent_reputation.push(row);
    return ok([cloneRow(row)], 1);
  }

  if (normalized.includes('from agent_reputation where agent_id = $1')) {
    const agentId = params[0];
    const row = state.tables.agent_reputation.find((item) => item.agent_id === agentId);
    return ok(row ? [cloneRow(row)] : [], row ? 1 : 0);
  }

  if (normalized.startsWith('update agent_reputation')) {
    const [totalPayments, successRate, trustScore, agentId] = params;
    const row = state.tables.agent_reputation.find((item) => item.agent_id === agentId);
    if (!row) return ok([], 0);
    row.total_payments = Number(totalPayments);
    row.success_rate = Number(successRate);
    row.trust_score = Number(trustScore);
    row.last_payment_at = now().toISOString();
    row.updated_at = now().toISOString();
    return ok([], 1);
  }

  if (normalized.startsWith('insert into merchant_invoices')) {
    const [merchantId, intentId, transactionId, feeAmount, feePercent, currency] = params;
    const row = {
      id: nextId('merchant_invoices'),
      merchant_id: merchantId,
      intent_id: intentId,
      transaction_id: transactionId,
      fee_amount: Number(feeAmount),
      fee_percent: Number(feePercent),
      currency,
      status: 'pending',
      created_at: now().toISOString(),
      updated_at: now().toISOString(),
    };
    state.tables.merchant_invoices.push(row);
    return ok([{
      id: row.id,
      merchantId: row.merchant_id,
      intentId: row.intent_id,
      transactionId: row.transaction_id,
      feeAmount: row.fee_amount,
      feePercent: row.fee_percent,
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }], 1);
  }

  if (normalized.includes('from merchant_invoices where merchant_id = $1')) {
    const [merchantId, limit = 50, offset = 0] = params;
    const rows = state.tables.merchant_invoices
      .filter((row) => row.merchant_id === merchantId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(Number(offset), Number(offset) + Number(limit))
      .map((row) => ({
        id: row.id,
        merchantId: row.merchant_id,
        intentId: row.intent_id,
        transactionId: row.transaction_id,
        feeAmount: row.fee_amount,
        feePercent: row.fee_percent,
        currency: row.currency,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    return ok(rows);
  }

  if (normalized.startsWith('insert into verification_certificates')) {
    const [, intentId, payload, signature, encoded] = params;
    state.tables.verification_certificates.push({
      id: nextId('verification_certificates'),
      intent_id: intentId,
      payload,
      signature,
      encoded,
      created_at: now().toISOString(),
    });
    return ok([], 1);
  }

  if (normalized.startsWith('select count(*) from transactions where status = $1')) {
    const status = params[0];
    const count = state.tables.transactions.filter((tx) => tx.status === status).length;
    return ok([{ count: String(count) }], 1);
  }

  return ok([], 0);
}

class Pool {
  constructor() {
    this.ending = false;
  }

  on() {}

  connect() {
    return Promise.resolve({
      query: (sql, params) => handleQuery(sql, params),
      release: () => {},
    });
  }

  query(sql, params, cb) {
    let actualParams = params;
    let actualCb = cb;
    if (typeof params === 'function') {
      actualCb = params;
      actualParams = [];
    }
    try {
      const result = handleQuery(sql, actualParams || []);
      return callbackOrPromise(result, actualCb);
    } catch (err) {
      return callbackError(err, actualCb);
    }
  }

  end() {
    this.ending = true;
    return Promise.resolve();
  }
}

module.exports = { Pool };
