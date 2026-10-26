import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Run `fn` while holding a Postgres advisory lock named `key`, so check-then-write steps on the
 * same thing (one room on one date, one college's publish) happen one at a time instead of
 * racing. The lock is released when the transaction ends. Writes `fn` makes with the global
 * client commit before the lock is released, so the next holder sees them.
 */
export function withLock<T>(key: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
