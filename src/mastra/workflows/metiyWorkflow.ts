/**
 * METIY Workflow
 * 
 * Two-step workflow following Agent Stack architecture:
 * Step 1: Call agent.generate() with user message
 * Step 2: Send response to Slack DM
 * 
 * ALL business logic is in the agent - workflow is just a connector
 */

import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { metiyAgent } from "../agents/metiyAgent";
import { getClient } from "../../triggers/slackTriggers";

/**
 * Step 1: Use METIY Agent
 * - Receives message from Slack
 * - Calls agent.generate() with message and thread context
 * - Agent orchestrates all tools (extract, analyze, save, etc.)
 * - Returns agent's response text
 */
const useAgentStep = createStep({
  id: "use-metiy-agent",
  description: "Processes user request through METIY agent",
  
  inputSchema: z.object({
    message: z.string().describe("User message from Slack"),
    threadId: z.string().describe("Thread ID for conversation persistence"),
    slackUserId: z.string().optional().describe("Slack user ID"),
    slackChannel: z.string().optional().describe("Slack channel ID"),
  }),
  
  outputSchema: z.object({
    response: z.string().describe("Agent response text"),
    threadId: z.string().describe("Thread ID used"),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { message, threadId, slackUserId, slackChannel } = inputData;
    
    logger?.info("🤖 [METIY Workflow Step 1] Starting agent processing", {
      threadId,
      messageLength: message.length,
    });
    
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
      
      logger?.info("✅ [METIY Workflow Step 1] Agent processing complete", {
        responseLength: text.length,
      });
      
      return {
        response: text,
        threadId,
      };
    } catch (error) {
      logger?.error("❌ [METIY Workflow Step 1] Agent processing failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      
      // Return error message to user
      return {
        response: `I encountered an error processing your request: ${error instanceof Error ? error.message : "Unknown error"}. Please try again or contact support if the issue persists.`,
        threadId,
      };
    }
  },
});

/**
 * Step 2: Send Reply to Slack
 * - Takes agent response from Step 1
 * - Posts message to Slack DM/channel
 * - Uses thread if available for context
 */
const sendReplyStep = createStep({
  id: "send-slack-reply",
  description: "Sends agent response to Slack",
  
  inputSchema: z.object({
    response: z.string().describe("Agent response to send"),
    channel: z.string().describe("Slack channel ID"),
    threadTs: z.string().optional().describe("Thread timestamp for threading"),
  }),
  
  outputSchema: z.object({
    sent: z.boolean().describe("Whether message was sent successfully"),
    messageTs: z.string().optional().describe("Timestamp of sent message"),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { response, channel, threadTs } = inputData;
    
    logger?.info("💬 [METIY Workflow Step 2] Sending Slack reply", {
      channel,
      hasThread: !!threadTs,
    });
    
    try {
      const { slack } = await getClient();
      
      const result = await slack.chat.postMessage({
        channel,
        text: response,
        thread_ts: threadTs,
      });
      
      logger?.info("✅ [METIY Workflow Step 2] Slack reply sent", {
        messageTs: result.ts,
      });
      
      return {
        sent: true,
        messageTs: result.ts,
      };
    } catch (error) {
      logger?.error("❌ [METIY Workflow Step 2] Failed to send Slack reply", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      
      return {
        sent: false,
      };
    }
  },
});

/**
 * METIY Workflow
 * 
 * Connects Slack messages to METIY agent
 * Step 1: Agent processes request (ALL business logic)
 * Step 2: Reply sent to Slack (ONLY messaging)
 */
export const metiyWorkflow = createWorkflow({
  id: "metiy-workflow",
  description: "METIY transcript analysis workflow",
  
  inputSchema: z.object({
    message: z.string().describe("User message from Slack"),
    threadId: z.string().describe("Thread ID for conversation"),
    slackUserId: z.string().optional(),
    slackChannel: z.string(),
    threadTs: z.string().optional(),
  }),
  
  outputSchema: z.object({
    response: z.string(),
    sent: z.boolean(),
    messageTs: z.string().optional(),
  }),
})
  .then(useAgentStep)
  .then(sendReplyStep)
  .commit();
