/**
 * tweetParser.test.ts – Unit tests for the tweet command parser.
 */

import { parseTweet, extractMentions } from '../src/services/tweetParser';

describe('parseTweet – tip / send / pay commands', () => {
  test('parses a basic tip command', () => {
    const result = parseTweet('@AgentPay tip 0.25 to @alice');
    expect(result).toEqual({
      type: 'tip',
      amount: 0.25,
      currency: 'USDC',
      recipient: '@alice',
    });
  });

  test('parses a send command', () => {
    const result = parseTweet('@AgentPay send 1 USDC to @bob');
    expect(result).toEqual({
      type: 'send',
      amount: 1,
      currency: 'USDC',
      recipient: '@bob',
    });
  });

  test('parses a pay-to-this command (no explicit recipient)', () => {
    const result = parseTweet('@AgentPay pay 0.10 to this');
    expect(result).toEqual({
      type: 'pay',
      amount: 0.10,
      currency: 'USDC',
      recipient: null,
    });
  });

  test('parses command without leading @AgentPay prefix', () => {
    const result = parseTweet('tip 5 to @carol');
    expect(result).not.toBeNull();
    expect(result?.amount).toBe(5);
    if (result && result.type !== 'paywall') {
      expect(result.recipient).toBe('@carol');
    }
  });

  test('returns null for unrecognised text', () => {
    expect(parseTweet('Hello world!')).toBeNull();
    expect(parseTweet('@AgentPay hello')).toBeNull();
  });

  test('returns null for negative or zero amounts', () => {
    expect(parseTweet('@AgentPay tip 0 to @alice')).toBeNull();
  });

  test('amount is correctly parsed as a float', () => {
    const result = parseTweet('@AgentPay tip 1.99 to @dave');
    expect(result?.amount).toBeCloseTo(1.99);
  });
});

describe('parseTweet – #paywall command', () => {
  test('parses a paywall hashtag', () => {
    const result = parseTweet('Read my article #paywall $0.05');
    expect(result).toEqual({ type: 'paywall', amount: 0.05, currency: 'USDC' });
  });

  test('parses paywall without dollar sign', () => {
    const result = parseTweet('#paywall 0.99');
    expect(result).toEqual({ type: 'paywall', amount: 0.99, currency: 'USDC' });
  });

  test('returns null for zero paywall amount', () => {
    expect(parseTweet('#paywall $0')).toBeNull();
  });
});

describe('extractMentions', () => {
  test('extracts mentions and excludes bot handle', () => {
    const mentions = extractMentions('@AgentPay tip 1 to @alice @bob', '@agentpay');
    expect(mentions).toContain('@alice');
    expect(mentions).toContain('@bob');
    expect(mentions).not.toContain('@agentpay');
  });

  test('returns empty array when no mentions', () => {
    expect(extractMentions('hello world', '@AgentPay')).toEqual([]);
  });
});
