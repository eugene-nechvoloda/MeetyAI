/**
 * MeetyAI Workflow
 *
 * Two-step workflow following Agent Stack architecture:
 * Step 1: Call agent.generate() with user message + update transcript status
 * Step 2: Send response to Slack DM + mark transcript as completed
 *
 * ALL business logic is in the agent - workflow is just a connector
 */

import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { metiyAgent } from "../agents/metiyAgent";
import { getClient } from "../../triggers/slackTriggers";

/**
 * Step 1: Use MeetyAI Agent
 * - Receives message from Slack
 * - Updates transcript status to analyzing
 * - Calls agent.generate() with message and thread context
 * - Agent orchestrates all tools (extract, analyze, save, etc.)
 * - Updates transcript status to compiling insights
 * - Returns agent's response text
 */
const useAgentStep = createStep({
  id: "use-metiy-agent",
  description: "Processes user request through MeetyAI agent",

  inputSchema: z.object({
    message: z.string().describe("User message from Slack"),
    threadId: z.string().describe("Thread ID for conversation persistence"),
    slackUserId: z.string().optional().describe("Slack user ID"),
    slackChannel: z.string().describe("Slack channel ID"),
    threadTs: z.string().optional().describe("Thread timestamp for threading"),
    transcriptId: z.string().optional().describe("Transcript ID being processed"),
  }),

  outputSchema: z.object({
    response: z.string().describe("Agent response text"),
    threadId: z.string().describe("Thread ID used"),
    channel: z.string().describe("Slack channel ID to send to"),
    threadTs: z.string().optional().describe("Thread timestamp for threading"),
    slackUserId: z.string().optional().describe("Slack user ID"),
    transcriptId: z.string().optional().describe("Transcript ID being processed"),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { message, threadId, slackUserId, slackChannel, threadTs, transcriptId } = inputData;

    logger?.info("🤖 [MeetyAI Workflow Step 1] Starting agent processing", {
      threadId,
      messageLength: message.length,
      transcriptId,
    });

    // Update transcript status to analyzing if transcript ID is provided
    if (transcriptId) {
      try {
        const { updateTranscriptStatus } = await import("../services/transcriptIngestion");
        const { TranscriptStatus } = await import("@prisma/client");

        await updateTranscriptStatus(transcriptId, TranscriptStatus.analyzing_pass_1, logger);

        logger?.info("✅ [MeetyAI Workflow Step 1] Transcript status updated to analyzing", {
          transcriptId,
        });
      } catch (statusError) {
        logger?.warn("⚠️ [MeetyAI Workflow Step 1] Failed to update transcript status", {
          error: statusError instanceof Error ? statusError.message : String(statusError),
          transcriptId,
        });
        // Don't fail workflow if status update fails
      }
    }

    try {
      // Call agent.generate() - the agent orchestrates all tools
      const { text } = await metiyAgent.generate(
        [
          {
            role: "user",
            content: message,
          },
        ],
        {
          resourceId: "metiy-bot",
          threadId,
          maxSteps: 5, // Allow up to 5 tool usage steps
        }
      );

      logger?.info("✅ [MeetyAI Workflow Step 1] Agent processing complete", {
        responseLength: text.length,
        transcriptId,
      });

      // Update transcript status to compiling insights
      if (transcriptId) {
        try {
          const { updateTranscriptStatus } = await import("../services/transcriptIngestion");
          const { TranscriptStatus } = await import("@prisma/client");

          await updateTranscriptStatus(transcriptId, TranscriptStatus.compiling_insights, logger);

          logger?.info("✅ [MeetyAI Workflow Step 1] Transcript status updated to compiling", {
            transcriptId,
          });
        } catch (statusError) {
          logger?.warn("⚠️ [MeetyAI Workflow Step 1] Failed to update status to compiling", {
            error: statusError instanceof Error ? statusError.message : String(statusError),
            transcriptId,
          });
        }
      }

      // Pass through channel, threadTs, slackUserId, and transcriptId for Step 2
      return {
        response: text,
        threadId,
        channel: slackChannel,
        threadTs,
        slackUserId,
        transcriptId,
      };
    } catch (error) {
      logger?.error("❌ [MeetyAI Workflow Step 1] Agent processing failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        transcriptId,
      });

      // Update transcript status to failed
      if (transcriptId) {
        try {
          const { updateTranscriptStatus } = await import("../services/transcriptIngestion");
          const { TranscriptStatus } = await import("@prisma/client");

          await updateTranscriptStatus(transcriptId, TranscriptStatus.failed, logger);

          logger?.error("❌ [MeetyAI Workflow Step 1] Transcript marked as failed", {
            transcriptId,
          });
        } catch (statusError) {
          logger?.warn("⚠️ [MeetyAI Workflow Step 1] Failed to update status to failed", {
            error: statusError instanceof Error ? statusError.message : String(statusError),
            transcriptId,
          });
        }
      }

      // Return error message to user
      return {
        response: `I encountered an error processing your request: ${error instanceof Error ? error.message : "Unknown error"}. Please try again or contact support if the issue persists.`,
        threadId,
        channel: slackChannel,
        threadTs,
        slackUserId,
        transcriptId,
      };
    }
  },
});

/**
 * Step 2: Send Reply to Slack
 * - Takes agent response from Step 1
 * - Posts message to Slack DM/channel
 * - Updates transcript status to completed
 * - Refreshes App Home to show updated status
 * - Uses thread if available for context
 */
const sendReplyStep = createStep({
  id: "send-slack-reply",
  description: "Sends agent response to Slack",

  inputSchema: z.object({
    response: z.string().describe("Agent response to send"),
    threadId: z.string().describe("Thread ID for conversation"),
    channel: z.string().describe("Slack channel ID"),
    threadTs: z.string().optional().describe("Thread timestamp for threading"),
    slackUserId: z.string().optional().describe("Slack user ID"),
    transcriptId: z.string().optional().describe("Transcript ID being processed"),
  }),

  outputSchema: z.object({
    response: z.string().describe("Agent response that was sent"),
    sent: z.boolean().describe("Whether message was sent successfully"),
    messageTs: z.string().optional().describe("Timestamp of sent message"),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { response, channel, threadTs, slackUserId, transcriptId } = inputData;

    logger?.info("💬 [MeetyAI Workflow Step 2] Sending Slack reply", {
      channel,
      hasThread: !!threadTs,
      transcriptId,
    });

    try {
      const { slack } = await getClient();

      const result = await slack.chat.postMessage({
        channel,
        text: response,
        thread_ts: threadTs,
      });

      logger?.info("✅ [MeetyAI Workflow Step 2] Slack reply sent", {
        messageTs: result.ts,
        transcriptId,
      });

      // Update transcript status to completed
      if (transcriptId) {
        try {
          const { updateTranscriptStatus } = await import("../services/transcriptIngestion");
          const { TranscriptStatus } = await import("@prisma/client");

          await updateTranscriptStatus(transcriptId, TranscriptStatus.completed, logger);

          logger?.info("✅ [MeetyAI Workflow Step 2] Transcript marked as completed", {
            transcriptId,
          });
        } catch (statusError) {
          logger?.warn("⚠️ [MeetyAI Workflow Step 2] Failed to update status to completed", {
            error: statusError instanceof Error ? statusError.message : String(statusError),
            transcriptId,
          });
        }
      }

      // Refresh App Home to show updated transcript status
      if (slackUserId) {
        try {
          const { buildHomeTab } = await import("../ui/appHomeViews");
          const homeView = await buildHomeTab(slackUserId);

          await slack.views.publish({
            user_id: slackUserId,
            view: homeView,
          });

          logger?.info("✅ [MeetyAI Workflow Step 2] App Home refreshed", { slackUserId });
        } catch (refreshError) {
          logger?.warn("⚠️ [MeetyAI Workflow Step 2] Failed to refresh App Home", {
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          });
          // Don't fail the workflow if App Home refresh fails
        }
      }

      return {
        response,
        sent: true,
        messageTs: result.ts,
      };
    } catch (error) {
      logger?.error("❌ [MeetyAI Workflow Step 2] Failed to send Slack reply", {
        error: error instanceof Error ? error.message : "Unknown error",
        transcriptId,
      });

      return {
        response,
        sent: false,
      };
    }
  },
});

/**
 * MeetyAI Workflow
 *
 * Connects Slack messages to MeetyAI agent
 * Step 1: Agent processes request (ALL business logic) + status updates
 * Step 2: Reply sent to Slack (ONLY messaging) + mark completed
 */
export const metiyWorkflow = createWorkflow({
  id: "metiy-workflow",
  description: "MeetyAI transcript analysis workflow - connects Slack to MeetyAI agent",

  inputSchema: z.object({
    message: z.string().describe("User message from Slack"),
    threadId: z.string().describe("Thread ID for conversation"),
    slackUserId: z.string().optional(),
    slackChannel: z.string().describe("Slack channel ID"),
    threadTs: z.string().optional().describe("Thread timestamp"),
    transcriptId: z.string().optional().describe("Transcript ID being processed"),
  }),

  outputSchema: z.object({
    response: z.string().describe("Agent response text"),
    sent: z.boolean().describe("Whether Slack message was sent"),
    messageTs: z.string().optional().describe("Sent message timestamp"),
  }),
})
  .then(useAgentStep)
  .then(sendReplyStep)
  .commit();
