export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      diagnostics: false,
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        module: 'commonjs',
      }
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/sdk/', '/\\.claude/', '/docs/archive/'],
  modulePathIgnorePatterns: ['/node_modules/', '/dist/', '/\\.claude/', '/docs/archive/'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  moduleNameMapper: {
    // Strip .js extensions so Jest (CommonJS) resolves the .ts source files
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // The generated Prisma client uses import.meta.url (ESM-only), which
    // breaks Jest's CommonJS transform. Map it to a lightweight mock kept
    // outside of any __mocks__ directory to avoid jest-haste-map duplicate
    // manual mock warnings.
    '\\.\\./generated/prisma/client': '<rootDir>/src/test/mocks/prisma-client.ts',
    '\\./generated/prisma/client': '<rootDir>/src/test/mocks/prisma-client.ts',
    'src/generated/prisma/client': '<rootDir>/src/test/mocks/prisma-client.ts',
    // Map direct @prisma/client imports (the runtime PrismaClient constructor)
    '^@prisma/client$': '<rootDir>/src/test/mocks/prisma-client.ts',
    // Provide lightweight runtime mocks for optional/native deps used by tests
    '^bcrypt$': '<rootDir>/src/test/mocks/bcryptMock.js',
    '^pg$': '<rootDir>/src/test/mocks/pgMock.js',
    '^@solana/web3.js$': '<rootDir>/src/test/mocks/solanaMock.js',
    '^uuid$': '<rootDir>/src/test/mocks/uuidMock.js',
    '^src/lib/prisma$': '<rootDir>/src/test/mocks/prisma-client.ts',
    // Map relative/practical import paths for `prisma` to the comprehensive test mock
    '^(\\.{1,2}/lib/prisma)(?:\\.js)?$': '<rootDir>/src/test/mocks/prisma-client.ts',
    '^\\./lib/prisma$': '<rootDir>/src/test/mocks/prisma-client.ts',
    '^jsonwebtoken$': '<rootDir>/src/test/mocks/jsonwebtokenMock.js',
  },
};
