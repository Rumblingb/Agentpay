// Lightweight Prisma client mock used only during tests to avoid requiring
// a real Prisma engine or runtime configuration.
export default {
  merchant: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  paymentIntent: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  verificationCertificate: { create: jest.fn() },
  agentrank_scores: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  agent: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
};
