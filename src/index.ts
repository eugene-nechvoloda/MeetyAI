/**
 * MeetyAI Rebuild - Main Server Entry Point
 *
 * Dual-AI transcript analysis with Claude Sonnet 4.5 + GPT-5
 */

import { App, ExpressReceiver } from '@slack/bolt';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize logger
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

// Initialize Prisma
export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

// Log Prisma queries in development
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e: any) => {
    logger.debug(`Query: ${e.query}`);
  });
}

prisma.$on('error', (e: any) => {
  logger.error('Prisma error:', e);
});

prisma.$on('warn', (e: any) => {
  logger.warn('Prisma warning:', e);
});

// Initialize Slack Bolt with ExpressReceiver
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  endpoints: '/slack/events',
});

export const slack = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Health check endpoint
receiver.router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
});

// Register Slack handlers
import './slack/handlers.js';

// Start server
const PORT = process.env.PORT || 5000;

(async () => {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Test AI API keys
    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn('⚠️  ANTHROPIC_API_KEY not set');
    }
    if (!process.env.OPENAI_API_KEY) {
      logger.warn('⚠️  OPENAI_API_KEY not set');
    }

    // Start server
    await slack.start(PORT);
    logger.info(`⚡️ MeetyAI server running on port ${PORT}`);
    logger.info(`📊 Dual-AI processing: Claude Sonnet 4.5 + GPT-5`);
    logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
    logger.info(`🤖 Slack events: http://localhost:${PORT}/slack/events`);

  } catch (error) {
    logger.error({ error }, '❌ Failed to start server');
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});
