export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        module: 'commonjs',
      }
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/sdk/'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  moduleNameMapper: {
    // The generated Prisma client uses import.meta.url (ESM-only), which
    // breaks Jest's CommonJS transform. Map it to a lightweight mock.
    '\\.\\./generated/prisma/client': '<rootDir>/src/__mocks__/prisma-client.ts',
    '\\./generated/prisma/client': '<rootDir>/src/__mocks__/prisma-client.ts',
    'src/generated/prisma/client': '<rootDir>/src/__mocks__/prisma-client.ts',
  },
};
