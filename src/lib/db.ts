import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function resolveSqlitePath(dbUrl: string) {
  const filePath = dbUrl.startsWith("file:")
    ? dbUrl.slice("file:".length)
    : dbUrl;

  // Match Prisma CLI: relative paths are from project root
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

function createPrismaClient() {
  const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const absolutePath = resolveSqlitePath(dbUrl);

  const adapter = new PrismaBetterSqlite3({
    url: `file:${absolutePath}`,
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
