import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  g.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, connectionTimeoutMillis: 5000 }),
    omit: { file: { bytes: true } }, // photo bytes are never selected by default
  });
if (process.env.NODE_ENV !== "production") g.prisma = prisma; // one client across hot reloads
