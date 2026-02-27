/**
 * Tests for the tweetParser utility.
 */

import {
  parseMention,
  extractMentions,
  isValidAmount,
  ParsedMention,
} from '../src/utils/tweetParser';

describe('parseMention', () => {
  it('parses a basic !tip command', () => {
    const result = parseMention('!tip @streamer1 10 USDC');
    expect(result.type).toBe('tip');
    expect(result.tipCommand?.amount).toBe(10);
    expect(result.tipCommand?.currency).toBe('USDC');
    expect(result.tipCommand?.recipient).toBe('streamer1');
  });

  it('parses a !tip command without currency (defaults to USDC)', () => {
    const result = parseMention('!tip @streamer1 5');
    expect(result.type).toBe('tip');
    expect(result.tipCommand?.currency).toBe('USDC');
  });

  it('parses a !tip command with USD currency', () => {
    const result = parseMention('!tip streamer1 2.50 USD great stream');
    expect(result.type).toBe('tip');
    expect(result.tipCommand?.amount).toBe(2.5);
    expect(result.tipCommand?.currency).toBe('USD');
  });

  it('parses a !paylink command', () => {
    const result = parseMention('!paylink streamer-abc_123');
    expect(result.type).toBe('paylink');
    expect(result.payLinkCode).toBe('streamer-abc_123');
  });

  it('parses a !verify command with a transaction hash', () => {
    const txHash = '5KtSyQPmKXkZ1J7VrALLNdQmC5h3iVxv3JNmVtJy6HWuLHxMaFGM4LdFhZYg9QBrRm';
    const result = parseMention(`!verify ${txHash}`);
    expect(result.type).toBe('verify');
    expect(result.txHash).toBe(txHash);
  });

  it('returns unknown for unrecognized commands', () => {
    const result = parseMention('hello world');
    expect(result.type).toBe('unknown');
  });

  it('returns unknown for empty string', () => {
    const result = parseMention('');
    expect(result.type).toBe('unknown');
  });

  it('preserves the raw text', () => {
    const text = '!tip @alice 10 USDC thanks!';
    const result = parseMention(text);
    expect(result.raw).toBe(text);
  });
});

describe('extractMentions', () => {
  it('extracts mentions from text, excluding bot handle', () => {
    const mentions = extractMentions('@agentpaybot @alice please tip @bob', 'agentpaybot');
    expect(mentions).toEqual(['alice', 'bob']);
  });

  it('returns empty array when no mentions', () => {
    const mentions = extractMentions('no mentions here', 'agentpaybot');
    expect(mentions).toEqual([]);
  });

  it('is case-insensitive for bot handle exclusion', () => {
    const mentions = extractMentions('@AgentPayBot @alice', 'agentpaybot');
    expect(mentions).toEqual(['alice']);
  });
});

describe('isValidAmount', () => {
  it('accepts positive finite amounts', () => {
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(0.01)).toBe(true);
    expect(isValidAmount(9999)).toBe(true);
  });

  it('rejects zero and negative amounts', () => {
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(-1)).toBe(false);
  });

  it('rejects amounts above maxAmount', () => {
    expect(isValidAmount(10001)).toBe(false);
    expect(isValidAmount(10001, 10000)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isValidAmount(Infinity)).toBe(false);
    expect(isValidAmount(NaN)).toBe(false);
  });

  it('accepts custom maxAmount', () => {
    expect(isValidAmount(50, 100)).toBe(true);
    expect(isValidAmount(101, 100)).toBe(false);
  });
});
