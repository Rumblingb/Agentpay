/**
 * Utility functions for parsing Twitter/X mentions and extracting
 * payment-related information from tweet text.
 */

export interface TipCommand {
  amount: number;
  currency: 'USDC' | 'USD';
  recipient: string;
  memo?: string;
}

export interface ParsedMention {
  type: 'tip' | 'paylink' | 'verify' | 'unknown';
  raw: string;
  tipCommand?: TipCommand;
  payLinkCode?: string;
  txHash?: string;
}

const TIP_PATTERN = /!tip\s+@?(\w+)\s+([\d.]+)\s*(usdc|usd)?/i;
const PAYLINK_PATTERN = /!paylink\s+([A-Za-z0-9_-]+)/i;
const VERIFY_PATTERN = /!verify\s+([A-Za-z0-9]{43,88})/i;

/**
 * Parses a tweet text and extracts AgentPay commands.
 */
export function parseMention(text: string): ParsedMention {
  const tipMatch = TIP_PATTERN.exec(text);
  if (tipMatch) {
    const amount = parseFloat(tipMatch[2]);
    const currency = (tipMatch[3]?.toUpperCase() as 'USDC' | 'USD') || 'USDC';
    return {
      type: 'tip',
      raw: text,
      tipCommand: {
        amount,
        currency,
        recipient: tipMatch[1],
      },
    };
  }

  const payLinkMatch = PAYLINK_PATTERN.exec(text);
  if (payLinkMatch) {
    return {
      type: 'paylink',
      raw: text,
      payLinkCode: payLinkMatch[1],
    };
  }

  const verifyMatch = VERIFY_PATTERN.exec(text);
  if (verifyMatch) {
    return {
      type: 'verify',
      raw: text,
      txHash: verifyMatch[1],
    };
  }

  return { type: 'unknown', raw: text };
}

/**
 * Extracts all @mentions from a tweet text (excluding the bot handle).
 */
export function extractMentions(text: string, botHandle: string): string[] {
  const mentionPattern = /@(\w+)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(text)) !== null) {
    if (match[1].toLowerCase() !== botHandle.toLowerCase()) {
      mentions.push(match[1]);
    }
  }
  return mentions;
}

/**
 * Validates that an amount is a positive finite number within allowed range.
 */
export function isValidAmount(amount: number, maxAmount = 10000): boolean {
  return Number.isFinite(amount) && amount > 0 && amount <= maxAmount;
}
