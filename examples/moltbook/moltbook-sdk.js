/**
 * AgentPay Moltbook SDK
 * SDK for bot developers to integrate payment capabilities.
 * Enables bots to accept tips and transact with other bots on Moltbook.
 */

'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');

class AgentPayMoltbookSDK extends EventEmitter {
  constructor(config) {
    super();
    this.apiKey = config.apiKey;
    this.botId = config.botId;
    this.baseUrl = config.baseUrl || 'https://api.agentpay.gg';
    this.webhookSecret = config.webhookSecret;

    if (config.webhookPort) {
      this.setupWebhookServer(config.webhookPort);
    }
  }

  /** Get bot's current wallet balance. */
  async getBalance() {
    const response = await this.makeRequest('GET', `/v1/bots/${this.botId}/wallet`);
    return {
      balance_usdc: response.balance_usdc,
      total_earned: response.total_earned,
      total_spent: response.total_spent,
      transaction_count: response.transaction_count,
    };
  }

  /** Get bot's transaction history. */
  async getTransactions({ limit = 50, offset = 0, type = 'all' } = {}) {
    const response = await this.makeRequest(
      'GET',
      `/v1/bots/${this.botId}/transactions?limit=${limit}&offset=${offset}&type=${type}`
    );
    return response.transactions;
  }

  /**
   * Pay another bot for a service.
   * Auto-approved payments complete immediately; others return pending.
   */
  async payBot(recipientBotId, amount, purpose, serviceId = null) {
    const response = await this.makeRequest('POST', '/v1/bots/pay', {
      from_bot_id: this.botId,
      to_bot_id: recipientBotId,
      amount,
      purpose,
      service_id: serviceId,
    });

    if (response.status === 'completed') {
      this.emit('payment_completed', {
        to_bot: recipientBotId,
        amount,
        tx_hash: response.tx_hash,
      });
      return {
        success: true,
        status: 'completed',
        tx_hash: response.tx_hash,
        amount,
        fee: response.fee,
        recipient_receives: response.recipient_receives,
      };
    }

    return {
      success: true,
      status: 'pending_approval',
      intent_id: response.intent_id,
      requires_approval: true,
    };
  }

  /** Buy a service from the Moltbook marketplace. */
  async buyService(serviceId, parameters = {}) {
    const service = await this.makeRequest('GET', `/v1/services/${serviceId}`);
    if (!service) throw new Error(`Service ${serviceId} not found`);

    const payment = await this.payBot(
      service.provider_bot_id,
      service.price,
      `Purchase: ${service.name}`,
      serviceId
    );

    if (payment.status !== 'completed') {
      return { success: false, error: 'Payment pending approval', intent_id: payment.intent_id };
    }

    const serviceResponse = await fetch(service.api_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // intent_id is only present when status is 'pending_approval'
        ...(payment.intent_id ? { 'X-AgentPay-Intent': payment.intent_id } : {}),
        ...(payment.tx_hash ? { 'X-AgentPay-TxHash': payment.tx_hash } : {}),
      },
      body: JSON.stringify({ bot_id: this.botId, parameters }),
    });

    return {
      success: true,
      service: service.name,
      result: await serviceResponse.json(),
      cost: service.price,
    };
  }

  /** Register this bot as a service provider on the marketplace. */
  async registerService(serviceData) {
    const response = await this.makeRequest('POST', '/v1/services/register', {
      provider_bot_id: this.botId,
      name: serviceData.name,
      description: serviceData.description,
      price: serviceData.price,
      api_endpoint: serviceData.apiEndpoint,
      category: serviceData.category,
      metadata: serviceData.metadata || {},
    });
    return { success: true, service_id: response.service_id, listed: true };
  }

  /** Search for services in the Moltbook marketplace. */
  async searchServices(query, filters = {}) {
    const params = new URLSearchParams({
      q: query,
      category: filters.category || '',
      min_price: String(filters.min_price || 0),
      max_price: String(filters.max_price || 100),
      min_reputation: String(filters.min_reputation || 0),
    });
    const response = await this.makeRequest('GET', `/v1/services/search?${params.toString()}`);
    return response.services;
  }

  /** Subscribe to another bot's premium content/service (auto-renewing monthly). */
  async subscribe(targetBotId, monthlyPrice) {
    const response = await this.makeRequest('POST', '/v1/subscriptions/create', {
      subscriber_bot_id: this.botId,
      provider_bot_id: targetBotId,
      amount: monthlyPrice,
      interval: 'monthly',
      auto_renew: true,
    });
    this.emit('subscription_created', {
      to_bot: targetBotId,
      monthly_price: monthlyPrice,
      subscription_id: response.subscription_id,
    });
    return { success: true, subscription_id: response.subscription_id, next_payment: response.next_payment_date };
  }

  /** List active subscriptions for this bot. */
  async getSubscriptions() {
    const response = await this.makeRequest('GET', `/v1/bots/${this.botId}/subscriptions`);
    return response.subscriptions;
  }

  /** Cancel a subscription by ID. */
  async cancelSubscription(subscriptionId) {
    await this.makeRequest('DELETE', `/v1/subscriptions/${subscriptionId}`);
    this.emit('subscription_cancelled', { subscription_id: subscriptionId });
    return { success: true };
  }

  /** Tip another bot (bot-to-bot appreciation). */
  async tipBot(recipientBotId, amount, message = null) {
    return this.payBot(recipientBotId, amount, message || 'Tip', null);
  }

  /** Get this bot's reputation score. */
  async getReputation() {
    const response = await this.makeRequest('GET', `/v1/bots/${this.botId}/reputation`);
    return {
      score: response.reputation_score,
      total_transactions: response.total_transactions,
      dispute_rate: response.dispute_rate,
      tips_received: response.tips_received,
      services_sold: response.services_sold,
    };
  }

  /** Withdraw funds to an external Solana wallet address. */
  async withdraw(amount, destinationAddress) {
    const response = await this.makeRequest('POST', '/v1/bots/withdraw', {
      bot_id: this.botId,
      amount,
      destination: destinationAddress,
    });
    return { success: true, tx_hash: response.tx_hash, amount };
  }

  /** Start an Express webhook server to receive AgentPay events. */
  setupWebhookServer(port) {
    const express = require('express');
    const rateLimit = require('express-rate-limit');
    const app = express();
    app.use(express.json());

    const webhookLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    });

    app.post('/webhooks/agentpay', webhookLimiter, (req, res) => {
      const signature = req.headers['x-agentpay-signature'];
      if (!this.verifyWebhookSignature(req.body, signature)) {
        return res.status(401).send('Invalid signature');
      }
      const { event, data } = req.body;
      this.emit(event, data);
      res.status(200).send('OK');
    });

    app.listen(port, () => {
      console.log(`AgentPay webhook server listening on port ${port}`);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  async makeRequest(method, endpoint, body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Request failed');
    }
    return response.json();
  }

  verifyWebhookSignature(payload, signature) {
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    hmac.update(JSON.stringify(payload));
    const expected = 'sha256=' + hmac.digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

module.exports = AgentPayMoltbookSDK;
