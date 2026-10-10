// Prisma 7: https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference
import { defineConfig } from "prisma/config";

try { process.loadEnvFile(); } catch {} // .env is optional; Render and CI inject env vars

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL }, // not env(): env() throws when unset and breaks `prisma generate`
});
