import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Load .env.local the same way Next.js does, so Prisma and the app share one env file.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"],
  },
});
