// Centralized runtime configuration accessor. Move all direct process.env
// reads to this file to make it easier to split runtime configs later.

export function getRuntimeConfig() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL || process.env.DATABASE_URL_PG || '',
    sentryDsn: process.env.SENTRY_DSN || '',
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
  } as const;
}

export const isProd = () => getRuntimeConfig().nodeEnv === 'production';
