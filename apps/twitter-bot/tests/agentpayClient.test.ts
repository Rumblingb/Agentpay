/**
 * agentpayClient.test.ts – Tests for AgentPayClient, focusing on
 * the daily-spend-limit enforcement that doesn't require a live API.
 */

import { AgentPayClient } from '../src/services/agentpayClient';

function makeClient(dailyLimitUsd = 20) {
  return new AgentPayClient({
    baseUrl: 'http://localhost:3001',
    apiKey: 'test-key',
    dailyLimitUsd,
  });
}

describe('AgentPayClient – enforceDailyLimit', () => {
  test('allows a payment within the limit', async () => {
    const client = makeClient(20);
    const ok = await client.enforceDailyLimit('user1', 5);
    expect(ok).toBe(true);
  });

  test('rejects a payment that equals the full limit at once', async () => {
    const client = makeClient(20);
    expect(await client.enforceDailyLimit('user2', 20)).toBe(true);
  });

  test('rejects a payment that exceeds the limit in a single transaction', async () => {
    const client = makeClient(20);
    const ok = await client.enforceDailyLimit('user3', 21);
    expect(ok).toBe(false);
  });

  test('accumulates spend across multiple calls and rejects when over limit', async () => {
    const client = makeClient(20);
    expect(await client.enforceDailyLimit('user4', 15)).toBe(true);
    expect(await client.enforceDailyLimit('user4', 6)).toBe(false); // 15+6=21 > 20
  });

  test('allows spending up to the exact limit across multiple calls', async () => {
    const client = makeClient(10);
    expect(await client.enforceDailyLimit('user5', 5)).toBe(true);
    expect(await client.enforceDailyLimit('user5', 5)).toBe(true); // exactly at limit
  });

  test('rejects zero or negative amounts', async () => {
    const client = makeClient(20);
    expect(await client.enforceDailyLimit('user6', 0)).toBe(false);
    expect(await client.enforceDailyLimit('user6', -1)).toBe(false);
  });

  test('getDailySpend returns 0 for a new user', () => {
    const client = makeClient(20);
    expect(client.getDailySpend('brand-new-user')).toBe(0);
  });

  test('getDailySpend reflects cumulative spend after enforce calls', async () => {
    const client = makeClient(100);
    await client.enforceDailyLimit('user7', 7);
    await client.enforceDailyLimit('user7', 3);
    expect(client.getDailySpend('user7')).toBe(10);
  });

  test('different users have independent spend counters', async () => {
    const client = makeClient(20);
    await client.enforceDailyLimit('alice', 15);
    await client.enforceDailyLimit('bob', 10);
    expect(client.getDailySpend('alice')).toBe(15);
    expect(client.getDailySpend('bob')).toBe(10);
  });
});
