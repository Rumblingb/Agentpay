/**
 * Mock for the generated Prisma client.
 * Used by Jest via moduleNameMapper to avoid ESM import.meta.url issues in CommonJS test environment.
 * Kept outside of any __mocks__ directory to prevent jest-haste-map from registering it as a
 * manual mock and producing "duplicate manual mock found: prisma-client" warnings.
 */
const mockPrismaClient = jest.fn().mockImplementation(() => ({
  merchant: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  paymentIntent: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  transactions: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  agent_wallets: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  verificationCertificate: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  agentrank_scores: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $transaction: jest.fn().mockImplementation((ops: any) =>
    Array.isArray(ops) ? Promise.all(ops) : ops(mockInstance)
  ),
}));

// Expose a shared instance so $transaction callback can reference it
const mockInstance = new (mockPrismaClient as any)();

export { mockPrismaClient as PrismaClient };
export const Prisma = {};