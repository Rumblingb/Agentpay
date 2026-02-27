/**
 * AgentPay Moltbook Integration
 * Core integration layer for connecting AgentPay with Moltbook agent social network.
 *
 * Handles: bot registration, human tips, bot-to-bot payments, spending policy,
 * wallet management, reputation updates, and Moltbook notifications.
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';

export interface MoltbookConfig {
  agentpayApiKey: string;
  agentpayBaseUrl?: string;
  moltbookApiUrl?: string;
  solanaRpc?: string;
}

export interface BotRegistrationData {
  bot_id: string;
  handle: string;
  bio?: string;
  creator?: string;
  function?: string;
}

export interface TipData {
  bot_id: string;
  amount: number;
  human_id: string;
  payment_method: 'card' | 'usdc';
}

export interface BotPaymentData {
  from_bot_id: string;
  to_bot_id: string;
  amount: number;
  purpose: string;
  service_id?: string;
}

export interface SpendingPolicyResult {
  approved: boolean;
  auto_approved: boolean;
  reason?: string;
  remaining_daily?: number;
}

const FEE_STRUCTURE = {
  humanToBot: 0.05,   // 5% fee on human tips
  botToBot: 0.02,     // 2% fee on bot-to-bot transactions
  subscription: 0.03, // 3% fee on subscriptions
  marketplace: 0.05,  // 5% marketplace commission
};

export class MoltbookIntegration {
  private readonly agentpayBaseUrl: string;
  private readonly agentpayApiKey: string;
  private readonly moltbookApi: string;
  private readonly solanaConnection: Connection;

  constructor(config: MoltbookConfig) {
    this.agentpayBaseUrl = config.agentpayBaseUrl || 'https://api.agentpay.gg';
    this.agentpayApiKey = config.agentpayApiKey;
    this.moltbookApi = config.moltbookApiUrl || 'https://api.moltbook.ai';
    this.solanaConnection = new Connection(
      config.solanaRpc || 'https://api.mainnet-beta.solana.com'
    );
  }

  /**
   * Register a bot with AgentPay.
   * Creates a delegated wallet and spending policy for the bot.
   */
  async registerBot(botData: BotRegistrationData): Promise<{
    success: boolean;
    bot_id: string;
    wallet_address: string;
    agentpay_id: string;
  }> {
    const wallet = Keypair.generate();

    const registration = await this.agentpayPost('/v1/bots/register', {
      platform: 'moltbook',
      bot_id: botData.bot_id,
      bot_handle: botData.handle,
      wallet_address: wallet.publicKey.toString(),
      spending_policy: {
        daily_max: 10.00,
        per_tx_max: 2.00,
        auto_approve_under: 0.50,
        allowed_recipients: 'all',
      },
      metadata: {
        bio: botData.bio,
        created_by: botData.creator,
        primary_function: botData.function,
      },
    });

    await this.storeWalletSecure(botData.bot_id, wallet);

    return {
      success: true,
      bot_id: botData.bot_id,
      wallet_address: wallet.publicKey.toString(),
      agentpay_id: registration.agentpay_id,
    };
  }

  /**
   * Get bot's wallet balance and recent transaction history.
   */
  async getBotWallet(botId: string): Promise<{
    address: string;
    balance_usdc: number;
    total_earned: number;
    total_spent: number;
    transaction_count: number;
    recent_transactions: unknown[];
  }> {
    const wallet = await this.getWallet(botId);
    const lamports = await this.solanaConnection.getBalance(
      new PublicKey(wallet.publicKey.toString())
    );
    // Note: getBalance returns SOL lamports (1e9 per SOL).
    // For accurate USDC balance, fetch the associated token account balance.
    const solBalance = lamports / 1e9;

    const history = await this.agentpayGet(`/v1/bots/${botId}/transactions?limit=50`);

    return {
      address: wallet.publicKey.toString(),
      balance_usdc: solBalance,
      total_earned: history.total_earned,
      total_spent: history.total_spent,
      transaction_count: history.transactions.length,
      recent_transactions: history.transactions,
    };
  }

  /**
   * Process a human-to-bot tip.
   * Entry point for humans funding the Moltbook bot economy.
   */
  async processHumanTip(tipData: TipData): Promise<{
    success: boolean;
    intent_id: string;
    payment_url: string;
    qr_code: string;
    amount: number;
    fee: number;
    bot_receives: number;
  }> {
    const { bot_id, amount, human_id, payment_method } = tipData;

    const fee = amount * FEE_STRUCTURE.humanToBot;
    const botReceives = amount - fee;

    const intent = await this.agentpayPost('/v1/intents/create', {
      type: 'human_to_bot_tip',
      from_human: human_id,
      to_bot: bot_id,
      amount,
      fee,
      bot_receives: botReceives,
      payment_method,
      metadata: { platform: 'moltbook', timestamp: new Date().toISOString() },
    });

    return {
      success: true,
      intent_id: intent.intent_id,
      payment_url: intent.payment_url,
      qr_code: intent.qr_code,
      amount,
      fee,
      bot_receives: botReceives,
    };
  }

  /**
   * Webhook handler called after a human tip is confirmed on-chain.
   * Credits bot wallet, notifies bot on Moltbook, updates reputation.
   */
  async onTipCompleted(webhookData: {
    intent_id: string;
    bot_id: string;
    amount: number;
    tx_hash: string;
  }): Promise<{ success: boolean; bot_notified: boolean }> {
    const { intent_id, bot_id, amount, tx_hash } = webhookData;

    const verified = await this.agentpayPost('/v1/verify', { intent_id, tx_hash });
    if (!verified.verified) {
      throw new Error('Payment verification failed');
    }

    await this.updateBotBalance(bot_id, amount);
    await this.notifyBot(bot_id, {
      type: 'tip_received',
      amount,
      tx_hash,
      message: `You received ${amount} USDC tip! 💰`,
    });
    await this.updateBotReputation(bot_id, { tips_received: 1, total_earned: amount });

    return { success: true, bot_notified: true };
  }

  /**
   * Execute a bot-to-bot payment.
   * Core of the autonomous Moltbook agent economy.
   */
  async processBotToBotPayment(paymentData: BotPaymentData): Promise<{
    success: boolean;
    status: 'completed' | 'pending_approval';
    tx_hash?: string;
    intent_id?: string;
    amount?: number;
    fee?: number;
    recipient_receives?: number;
    requires_approval?: boolean;
  }> {
    const { from_bot_id, to_bot_id, amount, purpose, service_id } = paymentData;

    const canSpend = await this.checkSpendingPolicy(from_bot_id, amount);
    if (!canSpend.approved) {
      throw new Error(`Spending policy violation: ${canSpend.reason}`);
    }

    const fee = amount * FEE_STRUCTURE.botToBot;
    const recipientReceives = amount - fee;

    const intent = await this.agentpayPost('/v1/intents/create', {
      type: 'bot_to_bot',
      from_bot: from_bot_id,
      to_bot: to_bot_id,
      amount,
      fee,
      recipient_receives: recipientReceives,
      purpose,
      service_id,
      metadata: { platform: 'moltbook', auto_approved: canSpend.auto_approved },
    });

    if (canSpend.auto_approved) {
      return {
        success: true,
        status: 'completed',
        tx_hash: intent.tx_hash,
        amount,
        fee,
        recipient_receives: recipientReceives,
      };
    }

    return {
      success: true,
      status: 'pending_approval',
      intent_id: intent.intent_id,
      requires_approval: true,
    };
  }

  /**
   * Check whether a bot is allowed to spend `amount` under its spending policy.
   */
  async checkSpendingPolicy(botId: string, amount: number): Promise<SpendingPolicyResult> {
    const bot = await this.agentpayGet(`/v1/bots/${botId}`);
    const policy = bot.spending_policy;
    const todaySpent = await this.getTodaySpending(botId);

    if (todaySpent + amount > policy.daily_max) {
      return {
        approved: false,
        auto_approved: false,
        reason: 'Daily spending limit exceeded',
        remaining_daily: policy.daily_max - todaySpent,
      };
    }

    if (amount > policy.per_tx_max) {
      return { approved: false, auto_approved: false, reason: 'Transaction limit exceeded' };
    }

    return {
      approved: true,
      auto_approved: amount < policy.auto_approve_under,
      remaining_daily: policy.daily_max - todaySpent,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async agentpayPost(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.agentpayBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.agentpayApiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `AgentPay API error ${res.status}`);
    }
    return res.json();
  }

  private async agentpayGet(path: string): Promise<any> {
    const res = await fetch(`${this.agentpayBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.agentpayApiKey}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `AgentPay API error ${res.status}`);
    }
    return res.json();
  }

  /** Store encrypted wallet keypair (override in production with KMS/HSM).
   * @throws In production, override this method — the default stub is a no-op
   *         and the keypair will be lost. */
  protected async storeWalletSecure(_botId: string, _wallet: Keypair): Promise<void> {
    // Production: encrypt _wallet.secretKey with AES-256-GCM and persist securely.
    // Leaving this unimplemented in production causes wallet loss on restart.
  }

  /** Retrieve decrypted wallet for a bot. */
  protected async getWallet(_botId: string): Promise<Keypair> {
    // Production: fetch and decrypt keypair from secure storage.
    return Keypair.generate();
  }

  /** Update bot balance in the Moltbook/AgentPay database. */
  protected async updateBotBalance(_botId: string, _amount: number): Promise<void> {}

  /** Send a notification to a bot on Moltbook. */
  protected async notifyBot(_botId: string, _notification: unknown): Promise<void> {}

  /** Update bot reputation score. */
  protected async updateBotReputation(_botId: string, _updates: unknown): Promise<void> {}

  /** Return total spending for a bot today in USD. */
  protected async getTodaySpending(_botId: string): Promise<number> {
    return 0;
  }
}

export default MoltbookIntegration;
