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
  testPathIgnorePatterns: ['/node_modules/', '/sdk/'],
  modulePathIgnorePatterns: ['/node_modules/', '/dist/'],
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
  },
};
