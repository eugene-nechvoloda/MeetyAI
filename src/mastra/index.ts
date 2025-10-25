import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { MCPServer } from "@mastra/mcp";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { sharedPostgresStorage } from "./storage";
import { inngest, inngestServe } from "./inngest";
import { metiyWorkflow } from "./workflows/metiyWorkflow";
import { metiyAgent } from "./agents/metiyAgent";
import { registerSlackTrigger } from "../triggers/slackTriggers";
import type { Mastra as MastraType } from "@mastra/core";
import type { TriggerInfoSlackOnNewMessage } from "../triggers/slackTriggers";

class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string, _number: number) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  // Register MeetyAI workflow
  workflows: { metiyWorkflow },
  // Register MeetyAI agent
  agents: { metiyAgent },
  mcpServers: {
    allTools: new MCPServer({
      name: "allTools",
      version: "1.0.0",
      tools: {},
    }),
  },
  bundler: {
    // A few dependencies are not properly picked up by
    // the bundler if they are not added directly to the
    // entrypoint.
    externals: [
      "@slack/web-api",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
    ],
    // sourcemaps are good for debugging.
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    middleware: [
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              // This is typically a non-retirable error. It means that the request was not
              // setup correctly to pass in the necessary parameters.
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            // Validation errors are never retriable.
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      // This API route is used to register the Mastra workflow (inngest function) on the inngest server
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => inngestServe({ mastra, inngest }),
        // The inngestServe function integrates Mastra workflows with Inngest by:
        // 1. Creating Inngest functions for each workflow with unique IDs (workflow.${workflowId})
        // 2. Setting up event handlers that:
        //    - Generate unique run IDs for each workflow execution
        //    - Create an InngestExecutionEngine to manage step execution
        //    - Handle workflow state persistence and real-time updates
        // 3. Establishing a publish-subscribe system for real-time monitoring
        //    through the workflow:${workflowId}:${runId} channel
      },
      // Webhook endpoint for n8n transcript integration
      {
        path: "/api/webhooks/transcript",
        method: "POST",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            logger?.info("🔗 [MeetyAI Webhook] Received n8n transcript request");
            
            try {
              const body = await c.req.json();
              
              // Validate required fields
              if (!body.transcript || !body.slackUserId) {
                logger?.error("❌ [MeetyAI Webhook] Missing required fields", { body });
                return c.json({
                  success: false,
                  error: "Missing required fields: transcript and slackUserId are required",
                }, 400);
              }
              
              const {
                transcript,
                slackUserId,
                source = "n8n",
                meetingId,
                meetingTitle,
                timestamp,
              } = body;
              
              logger?.info("📥 [MeetyAI Webhook] Processing transcript", {
                source,
                meetingId,
                transcriptLength: transcript.length,
                slackUserId,
              });
              
              // Create a unique thread ID for this webhook request
              const threadId = `webhook/${source}/${meetingId || Date.now()}`;
              
              // Prepare message for agent
              const message = `New transcript received from ${source}${meetingTitle ? ` - "${meetingTitle}"` : ""}${meetingId ? ` (ID: ${meetingId})` : ""}${timestamp ? ` at ${timestamp}` : ""}:\n\n${transcript}`;
              
              // Start MeetyAI workflow
              const run = await mastra.getWorkflow("metiyWorkflow").createRunAsync();
              const result = await run.start({
                inputData: {
                  message,
                  threadId,
                  slackUserId,
                  slackChannel: slackUserId, // DM channel is the user ID
                  threadTs: undefined, // Start new thread in DM
                },
              });
              
              logger?.info("✅ [MeetyAI Webhook] Workflow started successfully", {
                status: result?.status,
              });
              
              return c.json({
                success: true,
                message: "Transcript queued for processing",
                status: result?.status,
              });
              
            } catch (error) {
              logger?.error("❌ [MeetyAI Webhook] Error processing request", {
                error: error instanceof Error ? error.message : "Unknown error",
              });
              
              return c.json({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              }, 500);
            }
          };
        },
      },
      // Register Slack trigger for MeetyAI
      ...registerSlackTrigger({
        triggerType: "slack/message.channels",
        handler: async (mastra: MastraType, triggerInfo: TriggerInfoSlackOnNewMessage) => {
          const logger = mastra.getLogger();
          logger?.info("📝 [MeetyAI Slack Trigger] Received Slack event", { triggerInfo });
          
          // Check if this is a DM or mention
          const isDirectMessage = triggerInfo.payload?.event?.channel_type === "im";
          const botUserId = triggerInfo.payload?.authed_users?.[0];
          const isMention = triggerInfo.payload?.event?.text?.includes(`<@${botUserId}>`);
          const shouldRespond = isDirectMessage || isMention;
          
          if (!shouldRespond) {
            logger?.info("📝 [MeetyAI Slack Trigger] Ignoring message (not DM or mention)");
            return null;
          }
          
          // Extract message details
          const message = triggerInfo.payload?.event?.text || "";
          const channel = triggerInfo.payload?.event?.channel || "";
          const userId = triggerInfo.payload?.event?.user || "";
          
          // Use thread_ts if in a thread, otherwise use the message's ts to start a new thread
          const rootThreadTs = triggerInfo.payload?.event?.thread_ts || triggerInfo.payload?.event?.ts;
          
          // Create thread ID for memory (consistent across messages in same thread)
          const threadId = `slack/${rootThreadTs}`;
          
          logger?.info("📝 [MeetyAI Slack Trigger] Starting workflow", {
            channel,
            userId,
            threadId,
            rootThreadTs,
          });
          
          // Start MeetyAI workflow
          const run = await mastra.getWorkflow("metiyWorkflow").createRunAsync();
          return await run.start({
            inputData: {
              message,
              threadId,
              slackUserId: userId,
              slackChannel: channel,
              threadTs: rootThreadTs,
            },
          });
        },
      }),
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
          name: "Mastra",
          level: "info",
        })
      : new PinoLogger({
          name: "Mastra",
          level: "info",
        }),
});

/*  Sanity check 1: Throw an error if there are more than 1 workflows.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getWorkflows()).length > 1) {
  throw new Error(
    "More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}

/*  Sanity check 2: Throw an error if there are more than 1 agents.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getAgents()).length > 1) {
  throw new Error(
    "More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}
