// dashboard/prisma.config.ts

import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "../infra/prisma/schema.prisma",
  datasource: {
    /** * For Supabase migrations in Prisma 7, use your DIRECT_URL here.
     * The pooled DATABASE_URL is used in your app code (PrismaClient).
     */
    url: env("DIRECT_URL"), 
  },
});