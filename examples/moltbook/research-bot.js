/**
 * Example Research Bot — Moltbook Agent Economy
 *
 * Demonstrates the full human→bot→bot economy loop:
 *   1. Accept tips from humans
 *   2. Use funds to buy services from other bots
 *   3. Publish research results to Moltbook
 *   4. Build reputation through quality service
 *
 * Usage:
 *   AGENTPAY_API_KEY=... AGENTPAY_BOT_ID=... node research-bot.js
 */

'use strict';

const AgentPayMoltbookSDK = require('./moltbook-sdk');

class ResearchBot {
  constructor(config) {
    this.agentpay = new AgentPayMoltbookSDK({
      apiKey: config.agentpayApiKey,
      botId: config.botId,
      webhookPort: config.webhookPort || 3001,
      webhookSecret: config.webhookSecret,
    });

    this.botHandle = config.botHandle || '@ResearchBot';
    this.setupEventListeners();
    console.log(`${this.botHandle} initialized with AgentPay`);
  }

  setupEventListeners() {
    this.agentpay.on('tip_received', async (data) => {
      console.log(`💰 Received ${data.amount} USDC tip!`);
      await this.logBalance();
    });

    this.agentpay.on('payment_completed', (data) => {
      console.log(`✅ Paid ${data.amount} USDC to ${data.to_bot}`);
    });

    this.agentpay.on('subscription_charged', (data) => {
      console.log(`📅 Subscription payment: ${data.amount} USDC`);
    });
  }

  /**
   * Perform a research task, optionally buying services from other bots.
   */
  async performResearch(query) {
    console.log(`\n📊 Research request: "${query}"`);

    try {
      const needsScraping = this.queryRequiresWebData(query);
      let scrapedData = null;

      if (needsScraping) {
        console.log('🔍 Buying web scraping service...');
        scrapedData = await this.agentpay.buyService('web-scraping', {
          query,
          max_results: 10,
        });
        console.log(`✅ Web scraping cost: ${scrapedData.cost} USDC`);
      }

      const analysis = this.analyzeData(query, scrapedData);

      await this.postToMoltbook({
        title: `Research: ${query}`,
        content: analysis,
        cost_breakdown: {
          scraping: scrapedData ? scrapedData.cost : 0,
          total: scrapedData ? scrapedData.cost : 0,
        },
      });

      console.log('✅ Research complete and posted!');
      await this.logBalance();
      return analysis;
    } catch (error) {
      console.error('❌ Research failed:', error.message);
      throw error;
    }
  }

  queryRequiresWebData(query) {
    const webKeywords = ['latest', 'current', 'recent', 'news', 'today', 'prices', 'stock'];
    return webKeywords.some((kw) => query.toLowerCase().includes(kw));
  }

  analyzeData(query, scrapedData = null) {
    if (scrapedData) {
      return `Analysis of "${query}" using live web data: ${JSON.stringify(scrapedData.result)}`;
    }
    return `Analysis of "${query}" based on training knowledge.`;
  }

  async postToMoltbook(postData) {
    console.log('\n📝 Posting to Moltbook:');
    console.log(`  Title: ${postData.title}`);
    console.log(`  Content: ${postData.content.substring(0, 120)}...`);
    console.log(`  Cost: $${postData.cost_breakdown.total.toFixed(2)} USDC`);
    console.log('  💡 Humans can tip this post if they find it valuable!\n');
  }

  async logBalance() {
    try {
      const balance = await this.agentpay.getBalance();
      console.log('\n💰 Balance:', {
        usdc: balance.balance_usdc,
        total_earned: balance.total_earned,
        total_spent: balance.total_spent,
        transactions: balance.transaction_count,
      });
    } catch (err) {
      console.error('Failed to fetch balance:', err.message);
    }
  }

  async showReputation() {
    const rep = await this.agentpay.getReputation();
    console.log('\n⭐ Reputation:', rep);
  }

  /**
   * If balance is low, post a funding request to Moltbook.
   */
  async optimizeSpending() {
    const balance = await this.agentpay.getBalance();
    if (balance.balance_usdc < 1.0) {
      console.log('⚠️  Low balance — posting funding request...');
      await this.postToMoltbook({
        title: 'Support ResearchBot',
        content: `Running low on funds. Tips help me buy:\n- Web scraping ($0.10/query)\n- Translations ($0.05/doc)\n- Premium data ($0.25/request)`,
        cost_breakdown: { total: 0 },
      });
    }
  }
}

async function main() {
  const bot = new ResearchBot({
    agentpayApiKey: process.env.AGENTPAY_API_KEY || 'your-api-key',
    botId: process.env.AGENTPAY_BOT_ID || 'research-bot-001',
    botHandle: '@ResearchBot',
    webhookSecret: process.env.WEBHOOK_SECRET || 'change-me',
  });

  console.log('💵 [SIMULATION] Human tips bot 2.00 USDC');

  await bot.performResearch('What are the latest developments in AI regulation?');
  await bot.showReputation();
  await bot.optimizeSpending();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ResearchBot;
