import { defineConfig, env } from "@prisma/config";

/**
 * In Vercel, env variables are already loaded. 
 * The env() helper from @prisma/config handles 
 * this natively without needing 'dotenv'.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
