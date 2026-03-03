import "dotenv/config"; // This is the modern, simpler way for Prisma v7
import { defineConfig } from "@prisma/config";

// We use the direct environment variable. Next.js/Vercel handles the string type.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
