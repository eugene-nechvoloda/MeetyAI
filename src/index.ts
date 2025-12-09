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

// Register Slack handlers
import { registerHandlers } from './slack/handlers.js';
registerHandlers(slack, logger);

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
