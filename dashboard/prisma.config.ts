import path from "path";
import { config } from "dotenv";
import { defineConfig } from "@prisma/config";

// Force dotenv to look in the current directory specifically
config({ path: path.resolve(process.cwd(), ".env") });

console.log("Checking DATABASE_URL:", process.env.DATABASE_URL ? "FOUND" : "NOT FOUND");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL || "",
  },
});