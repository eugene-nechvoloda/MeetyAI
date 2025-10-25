/**
 * Database Utility
 * 
 * Provides Prisma client instance and helper functions
 */

import { PrismaClient } from "@prisma/client";

// Singleton Prisma client
let prisma: PrismaClient | null = null;

/**
 * Gets or creates Prisma client instance
 */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" 
        ? ["query", "error", "warn"]
        : ["error"],
    });
  }
  return prisma;
}

/**
 * Disconnects Prisma client (for cleanup)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/**
 * Health check for database connection
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database connection check failed:", error);
    return false;
  }
}
