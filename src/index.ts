/**
 * MeetyAI - Simplified Architecture
 *
 * Removed: Mastra, Inngest workflows
 * Using: Express + Slack Bolt + Direct Anthropic API
 */

import express from 'express';
import bolt from '@slack/bolt';
import { config } from 'dotenv';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

const { App, ExpressReceiver } = bolt;

// Load environment variables
config();

// Initialize logger
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// Initialize Prisma
export const prisma = new PrismaClient();

// Initialize Express receiver for Slack
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  endpoints: '/slack/events',
});

// Initialize Slack Bolt app
export const slack = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  receiver,
});

// Get Express app from receiver
const app = receiver.app;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'meetyai-simplified' });
});

// Database status endpoint - see what's actually in the DB
app.get('/db-status', async (req, res) => {
  try {
    const pending = await prisma.transcript.count({ where: { status: 'pending' } });
    const processing = await prisma.transcript.count({ where: { status: 'processing' } });
    const processed = await prisma.transcript.count({ where: { status: 'processed' } });
    const failed = await prisma.transcript.count({ where: { status: 'failed' } });
    const totalInsights = await prisma.insight.count();

    const recentTranscripts = await prisma.transcript.findMany({
      take: 5,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        created_at: true,
        processed_at: true,
        _count: { select: { insights: true } }
      }
    });

    res.json({
      counts: { pending, processing, processed, failed, totalInsights },
      recent: recentTranscripts
    });
  } catch (error) {
    logger.error('[DB-STATUS] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Test endpoint to process latest pending transcript
app.get('/test-process-latest', async (req, res) => {
  logger.info(`[TEST] Finding latest pending transcript...`);

  try {
    // Find the most recent pending transcript
    const transcript = await prisma.transcript.findFirst({
      where: { status: 'pending' },
      orderBy: { created_at: 'desc' },
    });

    if (!transcript) {
      return res.json({ success: false, message: 'No pending transcripts found' });
    }

    logger.info(`[TEST] Found transcript ${transcript.id}, triggering processing...`);

    const { processTranscript } = await import('./services/transcriptProcessor.js');
    processTranscript(transcript.id)
      .then(() => {
        logger.info(`[TEST] Processing completed for ${transcript.id}`);
      })
      .catch((error) => {
        logger.error(`[TEST] Processing failed for ${transcript.id}:`, error);
      });

    res.json({
      success: true,
      message: 'Processing started',
      transcriptId: transcript.id,
      title: transcript.title
    });
  } catch (error) {
    logger.error(`[TEST] Failed to start processing:`, error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Register Slack handlers
import { registerHandlers } from './slack/handlers.js';
registerHandlers(slack, logger);

// RADICAL SOLUTION: Cron job to process pending transcripts every minute
// This ensures transcripts get processed even if the upload trigger fails
async function processPendingTranscripts() {
  try {
    const pendingTranscripts = await prisma.transcript.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },
      take: 10, // Process up to 10 at a time
    });

    if (pendingTranscripts.length === 0) {
      logger.debug('[CRON] No pending transcripts to process');
      return;
    }

    logger.info(`[CRON] Found ${pendingTranscripts.length} pending transcript(s), starting processing...`);

    const { processTranscript } = await import('./services/transcriptProcessor.js');

    // Process all pending transcripts in parallel
    await Promise.allSettled(
      pendingTranscripts.map(transcript =>
        processTranscript(transcript.id)
          .then(() => {
            logger.info(`[CRON] ✅ Successfully processed transcript ${transcript.id}`);
          })
          .catch((error) => {
            logger.error(`[CRON] ❌ Failed to process transcript ${transcript.id}:`, error);
          })
      )
    );
  } catch (error) {
    logger.error('[CRON] Error in processPendingTranscripts:', error);
  }
}

// Schedule cron job to run every minute
cron.schedule('* * * * *', () => {
  logger.debug('[CRON] Running scheduled check for pending transcripts...');
  processPendingTranscripts();
});

logger.info('🔄 Cron job scheduled: Will check for pending transcripts every minute');

// Start server
const PORT = parseInt(process.env.PORT || '5000', 10);

async function start() {
  try {
    // When using ExpressReceiver, start the Express app directly
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(PORT, () => {
        logger.info(`⚡️ MeetyAI server is running on port ${PORT}`);
        logger.info(`🎯 Simplified architecture - No Mastra, No Inngest`);
        resolve();
      });

      server.on('error', reject);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});
