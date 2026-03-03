import { defineConfig } from "@prisma/config";

// Vercel automatically injects DATABASE_URL from your Project Settings
console.log("Checking DATABASE_URL for Prisma:", process.env.DATABASE_URL ? "FOUND" : "NOT FOUND");

export default defineConfig({
  schema: "prisma/schema.prisma",
});
