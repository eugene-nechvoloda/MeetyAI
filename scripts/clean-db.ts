/**
 * Database Cleanup Script
 * Deletes all transcripts and insights
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanDatabase() {
  console.log('🧹 Cleaning database...');

  try {
    // Delete all insights first (though CASCADE should handle this)
    const deletedInsights = await prisma.insight.deleteMany({});
    console.log(`✅ Deleted ${deletedInsights.count} insights`);

    // Delete all transcripts (this will cascade delete related insights)
    const deletedTranscripts = await prisma.transcript.deleteMany({});
    console.log(`✅ Deleted ${deletedTranscripts.count} transcripts`);

    console.log('🎉 Database cleaned successfully!');
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDatabase();
