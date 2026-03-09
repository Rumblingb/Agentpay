 * Used by Jest via moduleNameMapper to avoid ESM import.meta.url issues in CommonJS test environment.
 * Kept outside of any __mocks__ directory to prevent jest-haste-map from registering it as a
 * manual mock and producing "duplicate manual mock found: prisma-client" warnings.