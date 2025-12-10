/**
 * Slack Event Handlers
 *
 * Registers all Slack event listeners, modals, actions, and commands
 */

import { slack, logger } from '../index.js';
import { buildHomeTab } from './views/appHome.js';
import { handleUploadModal } from './modals/uploadTranscript.js';
import { processTranscript } from '../services/transcriptProcessor.js';
import {
  createConversation,
  sendMessage,
  getOrCreateConversationForThread
} from '../services/chatService.js';

// App Home opened
slack.event('app_home_opened', async ({ event, client }) => {
  try {
    logger.info(`App home opened by user ${event.user}`);

    const view = await buildHomeTab(event.user);

    await client.views.publish({
      user_id: event.user,
      view,
    });
  } catch (error) {
    logger.error('Error handling app_home_opened:', error);
  }
});

// Upload transcript modal submission
slack.view('upload_transcript_modal', handleUploadModal);

// Re-analyze transcript button
slack.action('reanalyze_transcript', async ({ body, ack, client }) => {
  await ack();

  try {
    const transcriptId = body.actions[0].value;
    const userId = body.user.id;

    logger.info(`Re-analyze requested for transcript ${transcriptId}`);

    // Trigger re-analysis in background
    processTranscript(transcriptId).catch(error => {
      logger.error(`Re-analysis failed for ${transcriptId}:`, error);
    });

    // Update view
    const view = await buildHomeTab(userId);
    await client.views.publish({ user_id: userId, view });

  } catch (error) {
    logger.error('Error handling reanalyze:', error);
  }
});

// Archive transcript button
slack.action('archive_transcript', async ({ body, ack, client }) => {
  await ack();

  try {
    const transcriptId = body.actions[0].value;
    const userId = body.user.id;

    logger.info(`Archive requested for transcript ${transcriptId}`);

    const { prisma } = await import('../index.js');

    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { archived: true, archived_at: new Date() },
    });

    // Update view
    const view = await buildHomeTab(userId);
    await client.views.publish({ user_id: userId, view });

  } catch (error) {
    logger.error('Error handling archive:', error);
  }
});

// Upload button - opens modal
slack.action('upload_transcript_button', async ({ body, ack, client }) => {
  await ack();

  try {
    const { buildUploadModal } = await import('./views/uploadModal.js');

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildUploadModal(),
    });
  } catch (error) {
    logger.error('Error opening upload modal:', error);
  }
});

// Start chat button - opens DM with bot
slack.action('start_chat_button', async ({ body, ack, client }) => {
  await ack();

  try {
    const userId = body.user.id;

    logger.info(`Start chat requested by user ${userId}`);

    // Send welcome message in DM
    await client.chat.postMessage({
      channel: userId,
      text: '👋 Hi! I\'m your MeetyAI assistant. Ask me anything about your transcripts or how to use MeetyAI!',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '👋 *Hi! I\'m your MeetyAI assistant.*\n\nI can help you with:\n• Questions about your transcripts\n• Analyzing insights\n• General MeetyAI assistance\n\nJust type your message below to start chatting!',
          },
        },
      ],
    });

  } catch (error) {
    logger.error('Error handling start chat:', error);
  }
});

// Handle direct messages to the bot
slack.event('message', async ({ event, client }) => {
  try {
    // Ignore bot messages and messages without text
    if (event.subtype || event.bot_id || !event.text) {
      return;
    }

    const userId = event.user;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const messageText = event.text;

    logger.info(`Received message from user ${userId}: ${messageText.substring(0, 50)}...`);

    // Send typing indicator
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: '💭 Thinking...',
    });

    // Get or create conversation
    const conversation = await getOrCreateConversationForThread(
      userId,
      channelId,
      threadTs
    );

    // Get AI response
    const response = await sendMessage(conversation.id, messageText);

    // Send AI response
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: response.message,
    });

  } catch (error) {
    logger.error('Error handling message:', error);

    // Send error message to user
    try {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: '❌ Sorry, I encountered an error processing your message. Please try again.',
      });
    } catch (err) {
      logger.error('Error sending error message:', err);
    }
  }
});

// Handle app mentions (@MeetyAI)
slack.event('app_mention', async ({ event, client }) => {
  try {
    const userId = event.user;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const messageText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim(); // Remove bot mention

    logger.info(`Mentioned by user ${userId} in channel ${channelId}: ${messageText.substring(0, 50)}...`);

    // Send typing indicator
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: '💭 Thinking...',
    });

    // Get or create conversation
    const conversation = await getOrCreateConversationForThread(
      userId,
      channelId,
      threadTs
    );

    // Get AI response
    const response = await sendMessage(conversation.id, messageText);

    // Send AI response
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: response.message,
    });

  } catch (error) {
    logger.error('Error handling app mention:', error);

    // Send error message to user
    try {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: '❌ Sorry, I encountered an error processing your message. Please try again.',
      });
    } catch (err) {
      logger.error('Error sending error message:', err);
    }
  }
});

logger.info('✅ Slack handlers registered');
