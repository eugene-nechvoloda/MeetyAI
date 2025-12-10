/**
 * Chat Service - Handles conversational AI interactions
 */

import Anthropic from '@anthropic-ai/sdk';
import { MessageRole, ConversationStatus } from '@prisma/client';
import { logger, prisma } from '../index.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are MeetyAI Assistant, a helpful AI assistant integrated into a Slack workspace.

You help users with:
- Answering questions about their meeting transcripts and insights
- Providing analysis and recommendations
- Explaining insights and patterns in their data
- General assistance with the MeetyAI platform

Be concise, helpful, and friendly. When discussing transcripts or insights, be specific and cite relevant information.`;

interface ChatResponse {
  message: string;
  tokensUsed: number;
}

/**
 * Create a new chat conversation
 */
export async function createConversation(
  slackUserId: string,
  slackChannelId?: string,
  slackThreadTs?: string,
  transcriptId?: string
) {
  logger.info(`💬 Creating new conversation for user ${slackUserId}`);

  const conversation = await prisma.chatConversation.create({
    data: {
      slack_user_id: slackUserId,
      slack_channel_id: slackChannelId,
      slack_thread_ts: slackThreadTs,
      transcript_id: transcriptId,
      status: ConversationStatus.active,
      title: transcriptId ? 'Transcript Discussion' : 'New Chat',
    },
  });

  return conversation;
}

/**
 * Get conversation by ID
 */
export async function getConversation(conversationId: string) {
  return prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { created_at: 'asc' },
      },
    },
  });
}

/**
 * Get or create active conversation for a Slack thread
 */
export async function getOrCreateConversationForThread(
  slackUserId: string,
  slackChannelId: string,
  slackThreadTs: string
) {
  // Try to find existing conversation
  const existing = await prisma.chatConversation.findFirst({
    where: {
      slack_user_id: slackUserId,
      slack_thread_ts: slackThreadTs,
      archived: false,
    },
    include: {
      messages: {
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (existing) {
    return existing;
  }

  // Create new conversation
  return createConversation(slackUserId, slackChannelId, slackThreadTs);
}

/**
 * Get recent conversations for a user
 */
export async function getUserConversations(slackUserId: string, limit = 10) {
  return prisma.chatConversation.findMany({
    where: {
      slack_user_id: slackUserId,
      archived: false,
    },
    orderBy: {
      last_message_at: 'desc',
    },
    take: limit,
    include: {
      messages: {
        orderBy: { created_at: 'asc' },
        take: 5, // Include last 5 messages
      },
    },
  });
}

/**
 * Send a message and get AI response
 */
export async function sendMessage(
  conversationId: string,
  userMessage: string
): Promise<ChatResponse> {
  logger.info(`💬 Processing message in conversation ${conversationId}`);

  try {
    // Get conversation with history
    const conversation = await prisma.chatConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Save user message
    await prisma.chatMessage.create({
      data: {
        conversation_id: conversationId,
        role: MessageRole.user,
        content: userMessage,
      },
    });

    // Build message history for Claude
    const messages: Anthropic.MessageParam[] = [];

    // Add existing messages
    for (const msg of conversation.messages) {
      if (msg.role !== MessageRole.system) {
        messages.push({
          role: msg.role === MessageRole.user ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    // Get context if conversation is about a transcript
    let contextPrompt = SYSTEM_PROMPT;
    if (conversation.transcript_id) {
      const transcript = await prisma.transcript.findUnique({
        where: { id: conversation.transcript_id },
        include: {
          insights: {
            where: { archived: false },
          },
        },
      });

      if (transcript) {
        contextPrompt += `\n\nCONTEXT: You are discussing the transcript "${transcript.title}".`;
        if (transcript.insights.length > 0) {
          contextPrompt += `\n\nInsights from this transcript:\n`;
          transcript.insights.slice(0, 10).forEach((insight, idx) => {
            contextPrompt += `${idx + 1}. [${insight.type}] ${insight.title}: ${insight.description}\n`;
          });
        }
      }
    }

    // Call Anthropic API
    logger.info(`🤖 Calling Claude API for conversation ${conversationId}`);
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      system: contextPrompt,
      messages,
    });

    // Extract response text
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response format');
    }

    const assistantMessage = content.text;
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    logger.info(`✅ Generated response (${tokensUsed} tokens)`);

    // Save assistant message
    await prisma.chatMessage.create({
      data: {
        conversation_id: conversationId,
        role: MessageRole.assistant,
        content: assistantMessage,
        tokens_used: tokensUsed,
        model_used: 'claude-3-5-sonnet-20241022',
      },
    });

    // Update conversation last_message_at
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { last_message_at: new Date() },
    });

    return {
      message: assistantMessage,
      tokensUsed,
    };

  } catch (error) {
    logger.error(`❌ Failed to process message in conversation ${conversationId}:`, error);

    // Save error message
    await prisma.chatMessage.create({
      data: {
        conversation_id: conversationId,
        role: MessageRole.assistant,
        content: 'Sorry, I encountered an error processing your message. Please try again.',
        is_error: true,
        error_message: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}

/**
 * Archive a conversation
 */
export async function archiveConversation(conversationId: string) {
  logger.info(`📦 Archiving conversation ${conversationId}`);

  return prisma.chatConversation.update({
    where: { id: conversationId },
    data: {
      archived: true,
      archived_at: new Date(),
      status: ConversationStatus.archived,
    },
  });
}

/**
 * Delete a conversation (soft delete via archive)
 */
export async function deleteConversation(conversationId: string) {
  logger.info(`🗑️ Deleting conversation ${conversationId}`);

  return prisma.chatConversation.update({
    where: { id: conversationId },
    data: {
      archived: true,
      archived_at: new Date(),
      status: ConversationStatus.deleted,
    },
  });
}
