/**
 * Slack Message Tool
 * 
 * Sends formatted messages to Slack with Block Kit
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";

export const slackMessageTool = createTool({
  id: "send-slack-message",
  description: "Sends a message to Slack channel or DM. Use this to communicate analysis results and status updates to users.",
  
  inputSchema: z.object({
    channel: z.string().describe("Slack channel ID to send message to"),
    text: z.string().describe("Message text content"),
    threadTs: z.string().optional().describe("Thread timestamp to reply in thread"),
    blocks: z.any().optional().describe("Slack Block Kit blocks for rich formatting"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageTs: z.string().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = createLogger(mastra, "SlackMessageTool");
    const { channel, text, threadTs, blocks } = context;
    
    logger.toolStart("send-slack-message", { channel, hasBlocks: !!blocks });
    
    try {
      // Import Slack client
      const { getClient } = await import("../../triggers/slackTriggers");
      const { slack } = await getClient();
      
      const result = await slack.chat.postMessage({
        channel,
        text,
        thread_ts: threadTs,
        blocks: blocks || undefined,
      });
      
      logger.toolComplete("send-slack-message", {
        messageTs: result.ts,
      });
      
      return {
        success: true,
        messageTs: result.ts,
      };
    } catch (error) {
      logger.toolError("send-slack-message", error as Error);
      
      return {
        success: false,
        error: `Failed to send message: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
