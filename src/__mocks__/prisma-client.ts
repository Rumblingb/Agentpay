/**
 * Mock for the generated Prisma client.
 * Used by Jest to avoid ESM import.meta.url issues in CommonJS test environment.
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
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
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
}));

export { mockPrismaClient as PrismaClient };
export const Prisma = {};
