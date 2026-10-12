import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// The pg adapter sends timestamps as UTC wall time without an offset and reads timestamptz back the same way, so the
// session must be UTC: on a server in another zone, stored instants and now() in SQL would be off by the zone's offset.
const PG_UTC = "-c timezone=UTC";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  g.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, connectionTimeoutMillis: 5000, options: PG_UTC }),
    omit: { file: { bytes: true } }, // photo bytes are never selected by default
  });
if (process.env.NODE_ENV !== "production") g.prisma = prisma; // one client across hot reloads
