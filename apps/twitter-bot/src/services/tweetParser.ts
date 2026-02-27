/**
 * tweetParser.ts
 *
 * Parses incoming tweet text for AgentPay bot commands:
 *   @AgentPay tip 0.25 to @username
 *   @AgentPay send 1 USDC to @username
 *   @AgentPay pay 0.10 to this
 *   #paywall $0.05  (developer micropayment)
 */

export type ParsedCommand =
  | TipCommand
  | PaywallCommand;

export interface TipCommand {
  type: 'tip' | 'send' | 'pay';
  amount: number;
  currency: string;
  recipient: string | null;
}

export interface PaywallCommand {
  type: 'paywall';
  amount: number;
  currency: string;
}

// Matches: @AgentPay (tip|send|pay) <amount> [USDC] to @recipient
const TIP_REGEX =
  /(?:@AgentPay\s+)?(tip|send|pay)\s+([\d.]+)\s*(?:USDC\s+)?to\s+(@\w+|this)/i;

// Matches: #paywall $<amount>
const PAYWALL_REGEX = /#paywall\s+\$?([\d.]+)/i;

/**
 * Parse a tweet's full text.
 * Returns a ParsedCommand on success or null if no recognised command is found.
 */
export function parseTweet(text: string): ParsedCommand | null {
  const tipMatch = TIP_REGEX.exec(text);
  if (tipMatch) {
    const rawAction = tipMatch[1].toLowerCase() as TipCommand['type'];
    const amount = parseFloat(tipMatch[2]);
    const rawRecipient = tipMatch[3];
    if (isNaN(amount) || amount <= 0) return null;
    return {
      type: rawAction,
      amount,
      currency: 'USDC',
      recipient: rawRecipient === 'this' ? null : rawRecipient,
    };
  }

  const paywallMatch = PAYWALL_REGEX.exec(text);
  if (paywallMatch) {
    const amount = parseFloat(paywallMatch[1]);
    if (isNaN(amount) || amount <= 0) return null;
    return { type: 'paywall', amount, currency: 'USDC' };
  }

  return null;
}

/**
 * Extract all @mentions from tweet text (excluding the bot handle itself).
 */
export function extractMentions(text: string, botHandle: string): string[] {
  const matches = text.match(/@(\w+)/gi) ?? [];
  return matches
    .map((m) => m.toLowerCase())
    .filter((m) => m !== botHandle.toLowerCase());
}
