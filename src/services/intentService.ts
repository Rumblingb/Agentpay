import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';

export interface CreateIntentParams {
  merchantId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface IntentInstructions {
  recipientAddress: string;
  memo: string;
  solanaPayUri: string;
}

export interface PaymentIntentResult {
  intentId: string;
  verificationToken: string;
  expiresAt: Date;
  instructions: IntentInstructions;
}

/** Generate a verification token with the format APV_<timestamp>_<random> */
function generateVerificationToken(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  return `APV_${timestamp}_${random}`;
}

export async function createIntent(params: CreateIntentParams): Promise<PaymentIntentResult> {
  const { merchantId, amount, currency, metadata } = params;

  // Look up merchant wallet for payment instructions
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { walletAddress: true },
  });

  const intentId = uuidv4();
  const verificationToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await prisma.paymentIntent.create({
    data: {
      id: intentId,
      merchantId,
      amount,
      currency,
      status: 'pending',
      verificationToken,
      expiresAt,
      ...(metadata !== undefined && { metadata: metadata as object }),
    },
  });

  const recipientAddress = merchant.walletAddress;
  const solanaPayUri = `solana:${recipientAddress}?amount=${amount}&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&memo=${encodeURIComponent(verificationToken)}`;

  return {
    intentId,
    verificationToken,
    expiresAt,
    instructions: {
      recipientAddress,
      memo: verificationToken,
      solanaPayUri,
    },
  };
}
// Add this function to your intentService.ts
export async function getIntentById(intentId: string) {
  return await prisma.paymentIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      expiresAt: true,
      verificationToken: true,
      merchantId: true, // Crucial for the 403 ownership check
    },
  });
}

// Update your default export at the bottom

export async function getIntentStatus(
  intentId: string,
  merchantId: string
): Promise<{
  intentId: string;
  status: string;
  amount: number;
  currency: string;
  expiresAt: Date;
  verificationToken: string;
} | null> {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, merchantId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      expiresAt: true,
      verificationToken: true,
    },
  });

  if (!intent) return null;

  // Auto-expire intents past their expiry time
  if (intent.status === 'pending' && intent.expiresAt < new Date()) {
    await prisma.paymentIntent.update({
      where: { id: intentId },
      data: { status: 'expired' },
    });
    intent.status = 'expired';
  }

  return {
    intentId: intent.id,
    status: intent.status,
    amount: Number(intent.amount),
    currency: intent.currency,
    expiresAt: intent.expiresAt,
    verificationToken: intent.verificationToken,
  };
}
export default { createIntent, getIntentStatus, getIntentById };
