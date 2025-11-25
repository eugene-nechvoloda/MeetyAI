/**
 * Database Utility
 * 
 * Provides Prisma client instance and helper functions
 */

// ESM-compatible Prisma import using dynamic require
let PrismaClientClass: any = null;

async function loadPrismaClient() {
  if (!PrismaClientClass) {
    const pkg = await import("@prisma/client");
    PrismaClientClass = pkg.PrismaClient || (pkg as any).default?.PrismaClient;
  }
  return PrismaClientClass;
}

// Singleton Prisma client
let prisma: any = null;

/**
 * Gets or creates Prisma client instance (async for ESM compatibility)
 */
export async function getPrismaAsync(): Promise<any> {
  if (!prisma) {
    const PrismaClient = await loadPrismaClient();
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" 
        ? ["query", "error", "warn"]
        : ["error"],
    });
  }
  return prisma;
}

/**
 * Gets Prisma client instance (sync - requires prior initialization)
 * Call getPrismaAsync() first to ensure client is loaded
 */
export function getPrisma(): any {
  if (!prisma) {
    throw new Error("Prisma not initialized. Call getPrismaAsync() first.");
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
