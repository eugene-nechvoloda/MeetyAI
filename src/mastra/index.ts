import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { MCPServer } from "@mastra/mcp";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { sharedPostgresStorage } from "./storage";
import { inngest, inngestServe, registerCronWorkflow } from "./inngest";
import { metiyWorkflow } from "./workflows/metiyWorkflow";
import { zoomImportWorkflow } from "./workflows/zoomImportWorkflow";
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

// Register hourly Zoom import cron job (runs as Inngest function, not in Mastra UI)
registerCronWorkflow("0 * * * *", zoomImportWorkflow);

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  // Register MeetyAI workflow (only one workflow supported in Mastra UI)
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
      "@prisma/client",
      ".prisma/client",
    ],
    // sourcemaps are good for debugging.
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "5000", 10),
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
      // Webhook endpoint for external transcript integration (n8n, Zapier, custom APIs)
      {
        path: "/api/webhooks/transcript",
        method: "POST",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            logger?.info("🔗 [MeetyAI Webhook] Received transcript webhook request");
            
            try {
              // Optional authentication via X-MeetyAI-Secret header
              const authHeader = c.req.header("X-MeetyAI-Secret");
              const expectedSecret = process.env.MEETYAI_WEBHOOK_SECRET;
              if (expectedSecret && authHeader !== expectedSecret) {
                logger?.warn("🚫 [MeetyAI Webhook] Unauthorized request");
                return c.json({ success: false, error: "Unauthorized" }, 401);
              }
              
              const body = await c.req.json();
              
              // Support both old format (transcript) and new format (content)
              const content = body.content || body.transcript;
              const userId = body.userId || body.slackUserId;
              const title = body.title || body.meetingTitle || "Untitled Transcript";
              
              if (!content || !userId) {
                logger?.error("❌ [MeetyAI Webhook] Missing required fields", { 
                  hasContent: !!content,
                  hasUserId: !!userId,
                });
                return c.json({
                  success: false,
                  error: "Missing required fields: content/transcript and userId/slackUserId are required",
                }, 400);
              }
              
              const source = body.source || "custom_api";
              
              logger?.info("📥 [MeetyAI Webhook] Processing transcript", {
                source,
                title,
                contentLength: content.length,
                userId,
              });
              
              // Use the shared ingestion service
              const { ingestTranscript } = await import("./services/transcriptIngestion");
              const { TranscriptOrigin } = await import("@prisma/client");
              
              // Map source to TranscriptOrigin
              let origin: typeof TranscriptOrigin[keyof typeof TranscriptOrigin] = TranscriptOrigin.custom_api;
              if (source === "zoom") origin = TranscriptOrigin.zoom_import;
              else if (source === "fireflies") origin = TranscriptOrigin.fireflies_import;
              else if (source === "link") origin = TranscriptOrigin.link;
              
              const result = await ingestTranscript({
                title,
                content,
                origin,
                slackUserId: userId,
                slackChannelId: body.channelId,
                metadata: {
                  fileName: body.fileName,
                  fileType: body.fileType,
                  linkUrl: body.linkUrl,
                  zoomMeetingId: body.zoomMeetingId || body.meetingId,
                  firefliesId: body.firefliesId,
                  durationMinutes: body.durationMinutes,
                  participantCount: body.participantCount,
                  language: body.language,
                },
              }, logger);
              
              if (!result.success) {
                logger?.error("❌ [MeetyAI Webhook] Ingestion failed", { error: result.error });
                return c.json({
                  success: false,
                  error: result.error,
                }, 500);
              }
              
              logger?.info("✅ [MeetyAI Webhook] Transcript ingested successfully", {
                transcriptId: result.transcriptId,
                title,
              });
              
              return c.json({
                success: true,
                transcriptId: result.transcriptId,
                message: "Transcript received and queued for processing",
              }, 202);
              
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
      // Slack slash command: /meetyai analyze
      {
        path: "/api/slack/commands/analyze",
        method: "POST",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            logger?.info("🎮 [MeetyAI Slack Command] /meetyai analyze triggered");
            
            try {
              const formData = await c.req.formData();
              const triggerId = formData.get("trigger_id") as string;
              const userId = formData.get("user_id") as string;
              
              const { slack } = await (await import("../triggers/slackTriggers")).getClient();
              
              // Open Block Kit modal for transcript submission
              await slack.views.open({
                trigger_id: triggerId,
                view: {
                  type: "modal",
                  callback_id: "meetyai_analyze_modal",
                  title: {
                    type: "plain_text",
                    text: "Analyze Transcript",
                  },
                  submit: {
                    type: "plain_text",
                    text: "Analyze",
                  },
                  close: {
                    type: "plain_text",
                    text: "Cancel",
                  },
                  blocks: [
                    {
                      type: "section",
                      text: {
                        type: "mrkdwn",
                        text: "Submit a transcript for AI-powered analysis. Choose how to provide your transcript:",
                      },
                    },
                    {
                      type: "divider",
                    },
                    {
                      type: "input",
                      block_id: "transcript_text_block",
                      optional: true,
                      element: {
                        type: "plain_text_input",
                        action_id: "transcript_text",
                        multiline: true,
                        placeholder: {
                          type: "plain_text",
                          text: "Paste your transcript here...",
                        },
                      },
                      label: {
                        type: "plain_text",
                        text: "📝 Paste Transcript Text",
                      },
                    },
                    {
                      type: "input",
                      block_id: "transcript_link_block",
                      optional: true,
                      element: {
                        type: "plain_text_input",
                        action_id: "transcript_link",
                        placeholder: {
                          type: "plain_text",
                          text: "https://docs.google.com/document/d/...",
                        },
                      },
                      label: {
                        type: "plain_text",
                        text: "🔗 Or Paste Link to Transcript",
                      },
                    },
                    {
                      type: "context",
                      elements: [
                        {
                          type: "mrkdwn",
                          text: "💡 *Tip:* You can also upload files by attaching them to a DM with the bot.",
                        },
                      ],
                    },
                  ],
                },
              });
              
              logger?.info("✅ [MeetyAI Slack Command] Modal opened successfully");
              return c.text("", 200);
              
            } catch (error) {
              logger?.error("❌ [MeetyAI Slack Command] Error opening modal", {
                error: error instanceof Error ? error.message : "Unknown error",
              });
              return c.json({ error: "Failed to open modal" }, 500);
            }
          };
        },
      },
      // Slack slash command: /meetyai settings - Main settings menu
      {
        path: "/api/slack/commands/settings",
        method: "POST",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            logger?.info("⚙️ [MeetyAI Slack Command] /meetyai settings triggered");
            
            try {
              const formData = await c.req.formData();
              const userId = formData.get("user_id") as string;
              
              const { slack } = await (await import("../triggers/slackTriggers")).getClient();
              const { getPrisma } = await import("./utils/database");
              const prisma = getPrisma();
              
              // Get current settings
              const userSettings = await prisma.userSetting.findUnique({
                where: { user_id: userId },
              });
              
              const modelConfigs = await prisma.modelConfig.findMany({
                where: { user_id: userId },
              });
              
              const exportConfigs = await prisma.exportConfig.findMany({
                where: { user_id: userId },
              });
              
              // Send ephemeral message with settings menu
              await slack.chat.postEphemeral({
                channel: userId,
                user: userId,
                text: "⚙️ *MeetyAI Settings*",
                blocks: [
                  {
                    type: "header",
                    text: {
                      type: "plain_text",
                      text: "⚙️ MeetyAI Settings",
                    },
                  },
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: "Configure your MeetyAI experience:",
                    },
                  },
                  {
                    type: "divider",
                  },
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `*🤖 Model Configuration*\n${modelConfigs.length} model(s) configured\nChoose and customize AI models for analysis`,
                    },
                    accessory: {
                      type: "button",
                      text: {
                        type: "plain_text",
                        text: "Configure Models",
                      },
                      action_id: "open_model_settings",
                      value: userId,
                    },
                  },
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `*📤 Export Destinations*\n${exportConfigs.length} destination(s) configured\nSet up Linear, Airtable, and field mappings`,
                    },
                    accessory: {
                      type: "button",
                      text: {
                        type: "plain_text",
                        text: "Configure Exports",
                      },
                      action_id: "open_export_settings",
                      value: userId,
                    },
                  },
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `*⚡ General Preferences*\nResearch depth: ${userSettings?.research_depth || 0.7}\nConfigure analysis settings and notifications`,
                    },
                    accessory: {
                      type: "button",
                      text: {
                        type: "plain_text",
                        text: "General Settings",
                      },
                      action_id: "open_general_settings",
                      value: userId,
                    },
                  },
                  {
                    type: "context",
                    elements: [
                      {
                        type: "mrkdwn",
                        text: "💡 *Tip:* All sensitive data is encrypted and stored securely",
                      },
                    ],
                  },
                ],
              });
              
              logger?.info("✅ [MeetyAI Slack Command] Settings menu displayed");
              return c.text("", 200);
              
            } catch (error) {
              logger?.error("❌ [MeetyAI Slack Command] Error displaying settings menu", {
                error: error instanceof Error ? error.message : "Unknown error",
              });
              return c.json({ error: "Failed to display settings menu" }, 500);
            }
          };
        },
      },
      // Slack App Home events handler
      {
        path: "/api/slack/events",
        method: "POST",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            
            try {
              const body = await c.req.json();
              
              // Handle URL verification challenge
              if (body.type === "url_verification") {
                logger?.info("🔐 [Slack Events] URL verification challenge");
                return c.json({ challenge: body.challenge });
              }
              
              // Handle app_home_opened event
              if (body.event?.type === "app_home_opened") {
                logger?.info("🏠 [Slack App Home] User opened App Home", {
                  user: body.event.user,
                  tab: body.event.tab,
                });
                
                const { slack } = await (await import("../triggers/slackTriggers")).getClient();
                const userId = body.event.user;
                const tab = body.event.tab || "home";
                
                // Import App Home view builders
                const { buildHomeTab, buildTranscriptsTab, buildInsightsTab } = await import("./ui/appHomeViews");
                
                // Build the appropriate view based on selected tab
                let view;
                switch (tab) {
                  case "messages":
                    // Skip messages tab - not used
                    return c.json({ ok: true });
                  case "home":
                  default:
                    view = await buildHomeTab(userId);
                    break;
                }
                
                // Publish the view
                await slack.views.publish({
                  user_id: userId,
                  view: view as any,
                });
                
                logger?.info("✅ [Slack App Home] View published successfully");
                return c.json({ ok: true });
              }
              
              // Acknowledge other events
              return c.json({ ok: true });
              
            } catch (error) {
              logger?.error("❌ [Slack Events] Error handling event", {
                error: error instanceof Error ? error.message : "Unknown error",
              });
              return c.json({ error: "Failed to handle event" }, 500);
            }
          };
        },
      },
      // Slack modal submissions handler
      {
        path: "/api/slack/interactivity",
        method: "POST",
        createHandler: async ({ mastra }) => {
          return async (c) => {
            const logger = mastra.getLogger();
            
            try {
              const formData = await c.req.formData();
              const payloadStr = formData.get("payload") as string;
              const payload = JSON.parse(payloadStr);
              
              logger?.info("🎯 [MeetyAI Modal] Received interaction", {
                type: payload.type,
                callbackId: payload.view?.callback_id,
                actionId: payload.actions?.[0]?.action_id,
              });
              
              // Handle button clicks to open specific settings modals
              if (payload.type === "block_actions") {
                const action = payload.actions?.[0];
                const userId = payload.user.id;
                const { slack } = await (await import("../triggers/slackTriggers")).getClient();
                const { getPrisma } = await import("./utils/database");
                const prisma = getPrisma();
                
                if (action.action_id === "open_model_settings") {
                  // Get existing model configs
                  const modelConfigs = await prisma.modelConfig.findMany({
                    where: { user_id: userId },
                  });
                  
                  const defaultModel = modelConfigs.find(m => m.is_default);
                  
                  await slack.views.open({
                    trigger_id: payload.trigger_id,
                    view: {
                      type: "modal",
                      callback_id: "model_config_modal",
                      title: { type: "plain_text", text: "Model Configuration" },
                      submit: { type: "plain_text", text: "Save" },
                      close: { type: "plain_text", text: "Cancel" },
                      blocks: [
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "*Configure AI Model for Analysis*",
                          },
                        },
                        {
                          type: "divider",
                        },
                        {
                          type: "input",
                          block_id: "model_provider",
                          element: {
                            type: "static_select",
                            action_id: "provider",
                            placeholder: { type: "plain_text", text: "Select provider" },
                            options: [
                              { text: { type: "plain_text", text: "Anthropic Claude" }, value: "anthropic" },
                              { text: { type: "plain_text", text: "OpenAI GPT" }, value: "openai" },
                              { text: { type: "plain_text", text: "OpenRouter" }, value: "openrouter" },
                            ],
                            initial_option: defaultModel
                              ? { text: { type: "plain_text", text: defaultModel.provider === "anthropic" ? "Anthropic Claude" : defaultModel.provider === "openai" ? "OpenAI GPT" : "OpenRouter" }, value: defaultModel.provider }
                              : { text: { type: "plain_text", text: "Anthropic Claude" }, value: "anthropic" },
                          },
                          label: { type: "plain_text", text: "AI Provider" },
                        },
                        {
                          type: "input",
                          block_id: "model_name",
                          element: {
                            type: "plain_text_input",
                            action_id: "name",
                            placeholder: { type: "plain_text", text: "e.g., claude-3-5-sonnet-20241022, gpt-4o" },
                            initial_value: defaultModel?.model_name || "",
                          },
                          label: { type: "plain_text", text: "Model Name" },
                          optional: true,
                        },
                        {
                          type: "input",
                          block_id: "api_key",
                          element: {
                            type: "plain_text_input",
                            action_id: "key",
                            placeholder: { type: "plain_text", text: "sk-ant-... or sk-..." },
                          },
                          label: { type: "plain_text", text: "API Key (optional - leave blank to use default)" },
                          optional: true,
                        },
                        {
                          type: "context",
                          elements: [
                            { type: "mrkdwn", text: "🔐 API keys are encrypted with AES-256-GCM" },
                          ],
                        },
                      ],
                    },
                  });
                  
                  return c.json({ ok: true });
                  
                } else if (action.action_id === "open_export_settings") {
                  // Get existing export configs
                  const exportConfigs = await prisma.exportConfig.findMany({
                    where: { user_id: userId },
                  });
                  
                  const linearConfig = exportConfigs.find(e => e.provider === "linear");
                  
                  await slack.views.open({
                    trigger_id: payload.trigger_id,
                    view: {
                      type: "modal",
                      callback_id: "export_config_modal",
                      title: { type: "plain_text", text: "Export Configuration" },
                      submit: { type: "plain_text", text: "Save" },
                      close: { type: "plain_text", text: "Cancel" },
                      blocks: [
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "*Configure Export Destinations*\nSet up where insights should be exported",
                          },
                        },
                        {
                          type: "divider",
                        },
                        {
                          type: "input",
                          block_id: "export_provider",
                          element: {
                            type: "static_select",
                            action_id: "provider",
                            placeholder: { type: "plain_text", text: "Select destination" },
                            options: [
                              { text: { type: "plain_text", text: "Linear" }, value: "linear" },
                              { text: { type: "plain_text", text: "Airtable" }, value: "airtable" },
                              { text: { type: "plain_text", text: "Custom Webhook" }, value: "webhook" },
                            ],
                            initial_option: { text: { type: "plain_text", text: "Linear" }, value: "linear" },
                          },
                          label: { type: "plain_text", text: "Export Destination" },
                        },
                        {
                          type: "input",
                          block_id: "export_enabled",
                          element: {
                            type: "radio_buttons",
                            action_id: "enabled",
                            options: [
                              { text: { type: "plain_text", text: "Enabled" }, value: "true" },
                              { text: { type: "plain_text", text: "Disabled" }, value: "false" },
                            ],
                            initial_option: linearConfig?.enabled !== false
                              ? { text: { type: "plain_text", text: "Enabled" }, value: "true" }
                              : { text: { type: "plain_text", text: "Disabled" }, value: "false" },
                          },
                          label: { type: "plain_text", text: "Status" },
                        },
                        {
                          type: "input",
                          block_id: "export_api_key",
                          element: {
                            type: "plain_text_input",
                            action_id: "api_key",
                            placeholder: { type: "plain_text", text: "Enter API key or access token" },
                          },
                          label: { type: "plain_text", text: "API Key / Access Token" },
                          optional: true,
                        },
                        {
                          type: "input",
                          block_id: "export_team_id",
                          element: {
                            type: "plain_text_input",
                            action_id: "team_id",
                            placeholder: { type: "plain_text", text: "e.g., team-abc123 (for Linear)" },
                            initial_value: linearConfig?.team_id || "",
                          },
                          label: { type: "plain_text", text: "Team/Workspace ID" },
                          optional: true,
                        },
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "*Field Mapping*\nMap MeetyAI fields to destination fields:",
                          },
                        },
                        {
                          type: "input",
                          block_id: "field_mapping_title",
                          element: {
                            type: "plain_text_input",
                            action_id: "title",
                            placeholder: { type: "plain_text", text: "e.g., title, name" },
                            initial_value: "title",
                          },
                          label: { type: "plain_text", text: "Insight Title → " },
                          optional: true,
                        },
                        {
                          type: "input",
                          block_id: "field_mapping_description",
                          element: {
                            type: "plain_text_input",
                            action_id: "description",
                            placeholder: { type: "plain_text", text: "e.g., description, notes" },
                            initial_value: "description",
                          },
                          label: { type: "plain_text", text: "Insight Description → " },
                          optional: true,
                        },
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "*Data Filtering*",
                          },
                        },
                        {
                          type: "input",
                          block_id: "min_confidence",
                          element: {
                            type: "static_select",
                            action_id: "confidence",
                            placeholder: { type: "plain_text", text: "Minimum confidence" },
                            options: [
                              { text: { type: "plain_text", text: "Any (0.0+)" }, value: "0.0" },
                              { text: { type: "plain_text", text: "Low (0.3+)" }, value: "0.3" },
                              { text: { type: "plain_text", text: "Medium (0.5+)" }, value: "0.5" },
                              { text: { type: "plain_text", text: "High (0.7+)" }, value: "0.7" },
                              { text: { type: "plain_text", text: "Very High (0.9+)" }, value: "0.9" },
                            ],
                            initial_option: { text: { type: "plain_text", text: `High (${linearConfig?.min_confidence || 0.7}+)` }, value: String(linearConfig?.min_confidence || 0.7) },
                          },
                          label: { type: "plain_text", text: "Minimum Confidence Threshold" },
                        },
                        {
                          type: "input",
                          block_id: "types_filter",
                          element: {
                            type: "checkboxes",
                            action_id: "types",
                            options: [
                              { text: { type: "plain_text", text: "😣 Pains" }, value: "pain" },
                              { text: { type: "plain_text", text: "🚫 Blockers" }, value: "blocker" },
                              { text: { type: "plain_text", text: "😵 Confusion" }, value: "confusion" },
                              { text: { type: "plain_text", text: "❓ Questions" }, value: "question" },
                              { text: { type: "plain_text", text: "✨ Feature Requests" }, value: "feature_request" },
                              { text: { type: "plain_text", text: "💭 Ideas" }, value: "idea" },
                              { text: { type: "plain_text", text: "📈 Gains" }, value: "gain" },
                              { text: { type: "plain_text", text: "🎯 Outcomes" }, value: "outcome" },
                              { text: { type: "plain_text", text: "🚀 Opportunities" }, value: "opportunity" },
                              { text: { type: "plain_text", text: "⚠️ Objections" }, value: "objection" },
                              { text: { type: "plain_text", text: "💰 Buying Signals" }, value: "buying_signal" },
                              { text: { type: "plain_text", text: "💡 Insights" }, value: "insight" },
                              { text: { type: "plain_text", text: "💬 Feedback" }, value: "feedback" },
                              { text: { type: "plain_text", text: "📝 Other" }, value: "other" },
                            ],
                            initial_options: [
                              { text: { type: "plain_text", text: "😣 Pains" }, value: "pain" },
                              { text: { type: "plain_text", text: "🚫 Blockers" }, value: "blocker" },
                              { text: { type: "plain_text", text: "😵 Confusion" }, value: "confusion" },
                              { text: { type: "plain_text", text: "✨ Feature Requests" }, value: "feature_request" },
                              { text: { type: "plain_text", text: "💭 Ideas" }, value: "idea" },
                              { text: { type: "plain_text", text: "📈 Gains" }, value: "gain" },
                              { text: { type: "plain_text", text: "🎯 Outcomes" }, value: "outcome" },
                              { text: { type: "plain_text", text: "🚀 Opportunities" }, value: "opportunity" },
                              { text: { type: "plain_text", text: "⚠️ Objections" }, value: "objection" },
                              { text: { type: "plain_text", text: "💰 Buying Signals" }, value: "buying_signal" },
                              { text: { type: "plain_text", text: "💡 Insights" }, value: "insight" },
                            ],
                          },
                          label: { type: "plain_text", text: "Export These Insight Types" },
                          optional: true,
                        },
                        {
                          type: "context",
                          elements: [
                            { type: "mrkdwn", text: "💡 Only insights matching filters will be exported" },
                          ],
                        },
                      ],
                    },
                  });
                  
                  return c.json({ ok: true });
                  
                } else if (action.action_id === "open_insights_export_settings") {
                  // Get existing export configs (same as open_export_settings but triggered from Insights tab)
                  const exportConfigs = await prisma.exportConfig.findMany({
                    where: { user_id: userId },
                  });
                  
                  const linearConfig = exportConfigs.find(e => e.provider === "linear");
                  
                  await slack.views.open({
                    trigger_id: payload.trigger_id,
                    view: {
                      type: "modal",
                      callback_id: "export_config_modal",
                      title: { type: "plain_text", text: "Export Configuration" },
                      submit: { type: "plain_text", text: "Save" },
                      close: { type: "plain_text", text: "Cancel" },
                      blocks: [
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "*Configure Export Destinations*\nSet up where insights should be exported",
                          },
                        },
                        {
                          type: "divider",
                        },
                        {
                          type: "input",
                          block_id: "export_provider",
                          element: {
                            type: "static_select",
                            action_id: "provider",
                            placeholder: { type: "plain_text", text: "Select destination" },
                            options: [
                              { text: { type: "plain_text", text: "Linear" }, value: "linear" },
                              { text: { type: "plain_text", text: "Airtable" }, value: "airtable" },
                              { text: { type: "plain_text", text: "Custom Webhook" }, value: "webhook" },
                            ],
                            initial_option: { text: { type: "plain_text", text: "Linear" }, value: "linear" },
                          },
                          label: { type: "plain_text", text: "Export Destination" },
                        },
                        {
                          type: "input",
                          block_id: "export_enabled",
                          element: {
                            type: "radio_buttons",
                            action_id: "enabled",
                            options: [
                              { text: { type: "plain_text", text: "Enabled" }, value: "true" },
                              { text: { type: "plain_text", text: "Disabled" }, value: "false" },
                            ],
                            initial_option: linearConfig?.enabled !== false
                              ? { text: { type: "plain_text", text: "Enabled" }, value: "true" }
                              : { text: { type: "plain_text", text: "Disabled" }, value: "false" },
                          },
                          label: { type: "plain_text", text: "Status" },
                        },
                        {
                          type: "input",
                          block_id: "export_api_key",
                          element: {
                            type: "plain_text_input",
                            action_id: "api_key",
                            placeholder: { type: "plain_text", text: "Enter API key or access token" },
                          },
                          label: { type: "plain_text", text: "API Key / Access Token" },
                          optional: true,
                        },
                        {
                          type: "input",
                          block_id: "export_team_id",
                          element: {
                            type: "plain_text_input",
                            action_id: "team_id",
                            placeholder: { type: "plain_text", text: "e.g., team-abc123 (for Linear)" },
                            initial_value: linearConfig?.team_id || "",
                          },
                          label: { type: "plain_text", text: "Team/Workspace ID" },
                          optional: true,
                        },
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "*Field Mapping*\nMap MeetyAI fields to destination fields:",
                          },
                        },
                        {
                          type: "input",
                          block_id: "field_mapping_title",
                          element: {
                            type: "plain_text_input",
                            action_id: "title",
                            placeholder: { type: "plain_text", text: "e.g., title, name" },
                            initial_value: "title",
                          },
                          label: { type: "plain_text", text: "Insight Title → " },
                          optional: true,
                        },
                        {
                          type: "input",
                          block_id: "field_mapping_description",
                          element: {
                            type: "plain_text_input",
                            action_id: "description",
                            placeholder: { type: "plain_text", text: "e.g., description, notes" },
                            initial_value: "description",
                          },
                          label: { type: "plain_text", text: "Insight Description → " },
                          optional: true,
                        },
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "*Data Filtering*",
                          },
                        },
                        {
                          type: "input",
                          block_id: "min_confidence",
                          element: {
                            type: "static_select",
                            action_id: "confidence",
                            placeholder: { type: "plain_text", text: "Minimum confidence" },
                            options: [
                              { text: { type: "plain_text", text: "Any (0.0+)" }, value: "0.0" },
                              { text: { type: "plain_text", text: "Low (0.3+)" }, value: "0.3" },
                              { text: { type: "plain_text", text: "Medium (0.5+)" }, value: "0.5" },
                              { text: { type: "plain_text", text: "High (0.7+)" }, value: "0.7" },
                              { text: { type: "plain_text", text: "Very High (0.9+)" }, value: "0.9" },
                            ],
                            initial_option: { text: { type: "plain_text", text: `High (${linearConfig?.min_confidence || 0.7}+)` }, value: String(linearConfig?.min_confidence || 0.7) },
                          },
                          label: { type: "plain_text", text: "Minimum Confidence Threshold" },
                        },
                        {
                          type: "input",
                          block_id: "types_filter",
                          element: {
                            type: "checkboxes",
                            action_id: "types",
                            options: [
                              { text: { type: "plain_text", text: "😣 Pains" }, value: "pain" },
                              { text: { type: "plain_text", text: "🚫 Blockers" }, value: "blocker" },
                              { text: { type: "plain_text", text: "😵 Confusion" }, value: "confusion" },
                              { text: { type: "plain_text", text: "❓ Questions" }, value: "question" },
                              { text: { type: "plain_text", text: "✨ Feature Requests" }, value: "feature_request" },
                              { text: { type: "plain_text", text: "💭 Ideas" }, value: "idea" },
                              { text: { type: "plain_text", text: "📈 Gains" }, value: "gain" },
                              { text: { type: "plain_text", text: "🎯 Outcomes" }, value: "outcome" },
                              { text: { type: "plain_text", text: "🚀 Opportunities" }, value: "opportunity" },
                              { text: { type: "plain_text", text: "⚠️ Objections" }, value: "objection" },
                              { text: { type: "plain_text", text: "💰 Buying Signals" }, value: "buying_signal" },
                              { text: { type: "plain_text", text: "💡 Insights" }, value: "insight" },
                              { text: { type: "plain_text", text: "💬 Feedback" }, value: "feedback" },
                              { text: { type: "plain_text", text: "📝 Other" }, value: "other" },
                            ],
                            initial_options: [
                              { text: { type: "plain_text", text: "😣 Pains" }, value: "pain" },
                              { text: { type: "plain_text", text: "🚫 Blockers" }, value: "blocker" },
                              { text: { type: "plain_text", text: "😵 Confusion" }, value: "confusion" },
                              { text: { type: "plain_text", text: "✨ Feature Requests" }, value: "feature_request" },
                              { text: { type: "plain_text", text: "💭 Ideas" }, value: "idea" },
                              { text: { type: "plain_text", text: "📈 Gains" }, value: "gain" },
                              { text: { type: "plain_text", text: "🎯 Outcomes" }, value: "outcome" },
                              { text: { type: "plain_text", text: "🚀 Opportunities" }, value: "opportunity" },
                              { text: { type: "plain_text", text: "⚠️ Objections" }, value: "objection" },
                              { text: { type: "plain_text", text: "💰 Buying Signals" }, value: "buying_signal" },
                              { text: { type: "plain_text", text: "💡 Insights" }, value: "insight" },
                            ],
                          },
                          label: { type: "plain_text", text: "Export These Insight Types" },
                          optional: true,
                        },
                        {
                          type: "context",
                          elements: [
                            { type: "mrkdwn", text: "💡 Only insights matching filters will be exported" },
                          ],
                        },
                      ],
                    },
                  });
                  
                  logger?.info("✅ [App Home] Export settings modal opened from Insights tab");
                  return c.json({ ok: true });
                  
                } else if (action.action_id === "open_general_settings") {
                  // Get existing user settings
                  const userSettings = await prisma.userSetting.findUnique({
                    where: { user_id: userId },
                  });
                  
                  await slack.views.open({
                    trigger_id: payload.trigger_id,
                    view: {
                      type: "modal",
                      callback_id: "general_settings_modal",
                      title: { type: "plain_text", text: "General Settings" },
                      submit: { type: "plain_text", text: "Save" },
                      close: { type: "plain_text", text: "Cancel" },
                      blocks: [
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "*General Preferences*",
                          },
                        },
                        {
                          type: "divider",
                        },
                        {
                          type: "input",
                          block_id: "research_depth",
                          element: {
                            type: "static_select",
                            action_id: "depth",
                            placeholder: { type: "plain_text", text: "Select analysis depth" },
                            options: [
                              { text: { type: "plain_text", text: "Quick (0.3) - Fast, fewer insights" }, value: "0.3" },
                              { text: { type: "plain_text", text: "Standard (0.5) - Balanced" }, value: "0.5" },
                              { text: { type: "plain_text", text: "Deep (0.7) - Thorough, more insights" }, value: "0.7" },
                              { text: { type: "plain_text", text: "Maximum (1.0) - Most thorough" }, value: "1.0" },
                            ],
                            initial_option: { text: { type: "plain_text", text: `Deep (${userSettings?.research_depth || 0.7})` }, value: String(userSettings?.research_depth || 0.7) },
                          },
                          label: { type: "plain_text", text: "Research Depth" },
                        },
                        {
                          type: "input",
                          block_id: "auto_approve",
                          element: {
                            type: "radio_buttons",
                            action_id: "approve",
                            options: [
                              { text: { type: "plain_text", text: "Auto-approve insights" }, value: "true" },
                              { text: { type: "plain_text", text: "Manual approval required" }, value: "false" },
                            ],
                            initial_option: userSettings?.auto_approve
                              ? { text: { type: "plain_text", text: "Auto-approve insights" }, value: "true" }
                              : { text: { type: "plain_text", text: "Manual approval required" }, value: "false" },
                          },
                          label: { type: "plain_text", text: "Insight Approval" },
                        },
                        {
                          type: "input",
                          block_id: "notifications",
                          element: {
                            type: "checkboxes",
                            action_id: "notif",
                            options: [
                              { text: { type: "plain_text", text: "Notify on analysis completion" }, value: "completion" },
                              { text: { type: "plain_text", text: "Notify on failures" }, value: "failure" },
                            ],
                            initial_options: [
                              { text: { type: "plain_text", text: "Notify on analysis completion" }, value: "completion" },
                              { text: { type: "plain_text", text: "Notify on failures" }, value: "failure" },
                            ],
                          },
                          label: { type: "plain_text", text: "Notifications" },
                          optional: true,
                        },
                      ],
                    },
                  });
                  
                  return c.json({ ok: true });
                  
                } else if (action.action_id === "open_upload_modal") {
                  logger?.info("📤 [App Home] Opening upload modal", { userId });
                  
                  await slack.views.open({
                    trigger_id: payload.trigger_id,
                    view: {
                      type: "modal",
                      callback_id: "upload_transcript_modal",
                      title: {
                        type: "plain_text",
                        text: "Upload Transcript",
                      },
                      submit: {
                        type: "plain_text",
                        text: "Analyze",
                      },
                      close: {
                        type: "plain_text",
                        text: "Cancel",
                      },
                      blocks: [
                        {
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: "Submit a transcript for AI-powered analysis. Choose how to provide your transcript:",
                          },
                        },
                        {
                          type: "divider",
                        },
                        {
                          type: "input",
                          block_id: "transcript_text_block",
                          optional: true,
                          element: {
                            type: "plain_text_input",
                            action_id: "transcript_text",
                            multiline: true,
                            placeholder: {
                              type: "plain_text",
                              text: "Paste your transcript here...",
                            },
                          },
                          label: {
                            type: "plain_text",
                            text: "📝 Paste Transcript Text",
                          },
                        },
                        {
                          type: "input",
                          block_id: "transcript_link_block",
                          optional: true,
                          element: {
                            type: "plain_text_input",
                            action_id: "transcript_link",
                            placeholder: {
                              type: "plain_text",
                              text: "https://docs.google.com/document/d/...",
                            },
                          },
                          label: {
                            type: "plain_text",
                            text: "🔗 Or Paste Link to Transcript",
                          },
                        },
                        {
                          type: "context",
                          elements: [
                            {
                              type: "mrkdwn",
                              text: "💡 *Tip:* You can also upload files by attaching them to a DM with the bot.",
                            },
                          ],
                        },
                      ],
                    },
                  });
                  
                  logger?.info("✅ [App Home] Upload modal opened successfully");
                  return c.json({ ok: true });
                  
                } else if (action.action_id === "switch_to_home_tab") {
                  logger?.info("🏠 [App Home] Switching to Home tab", { userId });
                  
                  try {
                    const { buildHomeTab } = await import("./ui/appHomeViews");
                    const view = await buildHomeTab(userId);
                    
                    await slack.views.publish({
                      user_id: userId,
                      view: view as any,
                    });
                    
                    logger?.info("✅ [App Home] Switched to Home tab");
                    return c.json({ ok: true });
                  } catch (error) {
                    logger?.error("❌ [App Home] Error switching to Home tab", {
                      error: error instanceof Error ? error.message : "Unknown error",
                    });
                    return c.json({ ok: false, error: "Failed to switch tabs" }, 500);
                  }
                  
                } else if (action.action_id === "switch_to_transcripts_tab") {
                  logger?.info("📝 [App Home] Switching to Transcripts tab", { userId });
                  
                  try {
                    const { buildTranscriptsTab } = await import("./ui/appHomeViews");
                    const view = await buildTranscriptsTab(userId);
                    
                    await slack.views.publish({
                      user_id: userId,
                      view: view as any,
                    });
                    
                    logger?.info("✅ [App Home] Switched to Transcripts tab");
                    return c.json({ ok: true });
                  } catch (error) {
                    logger?.error("❌ [App Home] Error switching to Transcripts tab", {
                      error: error instanceof Error ? error.message : "Unknown error",
                    });
                    return c.json({ ok: false, error: "Failed to switch tabs" }, 500);
                  }
                  
                } else if (action.action_id === "switch_to_insights_tab") {
                  logger?.info("💡 [App Home] Switching to Insights tab", { userId });
                  
                  try {
                    const { buildInsightsTab } = await import("./ui/appHomeViews");
                    const view = await buildInsightsTab(userId);
                    
                    await slack.views.publish({
                      user_id: userId,
                      view: view as any,
                    });
                    
                    logger?.info("✅ [App Home] Switched to Insights tab");
                    return c.json({ ok: true });
                  } catch (error) {
                    logger?.error("❌ [App Home] Error switching to Insights tab", {
                      error: error instanceof Error ? error.message : "Unknown error",
                    });
                    return c.json({ ok: false, error: "Failed to switch tabs" }, 500);
                  }
                  
                } else if (action.action_id === "view_transcript_insights") {
                  const transcriptId = action.value;
                  logger?.info("🔍 [App Home] Viewing insights for transcript", { userId, transcriptId });
                  
                  try {
                    // Get insights for this transcript
                    const insights = await prisma.insight.findMany({
                      where: { transcript_id: transcriptId },
                      orderBy: { created_at: "desc" },
                      include: {
                        transcript: {
                          select: {
                            id: true,
                            title: true,
                          },
                        },
                      },
                    });
                    
                    const transcript = insights.length > 0 ? insights[0].transcript : null;
                    
                    // Build insights view for this transcript
                    const blocks: any[] = [
                      {
                        type: "section",
                        text: {
                          type: "mrkdwn",
                          text: `*Insights for: ${transcript?.title || "Transcript"}* 💡`,
                        },
                      },
                      {
                        type: "divider",
                      },
                    ];
                    
                    if (insights.length === 0) {
                      blocks.push({
                        type: "section",
                        text: {
                          type: "mrkdwn",
                          text: "No insights found for this transcript.",
                        },
                      });
                    } else {
                      for (const insight of insights) {
                        const statusBadge = insight.exported ? "✅ Exported" : "🆕 New";
                        const typeEmoji: Record<string, string> = {
                          pain: "😣",
                          blocker: "🚫",
                          feature_request: "✨",
                          idea: "💭",
                          gain: "📈",
                          outcome: "🎯",
                          objection: "⚠️",
                          buying_signal: "💰",
                        };
                        const emoji = typeEmoji[insight.type] || "💡";
                        
                        blocks.push({
                          type: "section",
                          text: {
                            type: "mrkdwn",
                            text: `${emoji} *${insight.title}*\n${insight.description}\n\n_${statusBadge} • Confidence: ${(insight.confidence * 100).toFixed(0)}%_`,
                          },
                          accessory: insight.exported ? undefined : {
                            type: "button",
                            text: {
                              type: "plain_text",
                              text: "Export",
                            },
                            action_id: "export_single_insight",
                            value: insight.id,
                          },
                        });
                        
                        blocks.push({
                          type: "divider",
                        });
                      }
                    }
                    
                    // Update App Home view
                    await slack.views.publish({
                      user_id: userId,
                      view: {
                        type: "home",
                        blocks,
                      } as any,
                    });
                    
                    logger?.info("✅ [App Home] Insights view published");
                    return c.json({ ok: true });
                  } catch (error) {
                    logger?.error("❌ [App Home] Error viewing transcript insights", {
                      error: error instanceof Error ? error.message : "Unknown error",
                    });
                    return c.json({ ok: false, error: "Failed to view insights" }, 500);
                  }
                  
                } else if (action.action_id === "export_all_linear") {
                  logger?.info("📤 [App Home] Exporting all new insights to Linear", { userId });
                  
                  try {
                    // Get all non-exported insights for this user
                    const insights = await prisma.insight.findMany({
                      where: {
                        transcript: {
                          slack_user_id: userId,
                        },
                        exported: false,
                      },
                      select: {
                        id: true,
                      },
                    });
                    
                    const insightIds = insights.map(i => i.id);
                    
                    if (insightIds.length === 0) {
                      // Send ephemeral message
                      await slack.chat.postEphemeral({
                        channel: userId,
                        user: userId,
                        text: "No new insights to export. All insights have already been exported.",
                      });
                      
                      logger?.info("ℹ️ [App Home] No new insights to export");
                      return c.json({ ok: true });
                    }
                    
                    logger?.info("📋 [App Home] Found insights to export", { count: insightIds.length });
                    
                    // Get the export tool from mastra
                    const { exportLinearTool } = await import("./tools/exportLinearTool");
                    
                    // Execute the export tool
                    const result = await exportLinearTool.execute({
                      context: { insightIds, userId },
                      mastra,
                      runtimeContext: {},
                    });
                    
                    // Send result message
                    await slack.chat.postEphemeral({
                      channel: userId,
                      user: userId,
                      text: result.success 
                        ? `✅ Successfully exported ${result.exportedCount} insight(s) to Linear!${result.failedCount > 0 ? ` (${result.failedCount} failed)` : ""}`
                        : `❌ Export failed: ${result.error}`,
                    });
                    
                    logger?.info("✅ [App Home] Linear export completed", {
                      exported: result.exportedCount,
                      failed: result.failedCount,
                    });
                    
                    return c.json({ ok: true });
                  } catch (error) {
                    logger?.error("❌ [App Home] Error exporting to Linear", {
                      error: error instanceof Error ? error.message : "Unknown error",
                    });
                    
                    await slack.chat.postEphemeral({
                      channel: userId,
                      user: userId,
                      text: `❌ Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                    });
                    
                    return c.json({ ok: false, error: "Export failed" }, 500);
                  }
                  
                } else if (action.action_id === "export_all_airtable") {
                  logger?.info("📤 [App Home] Exporting all new insights to Airtable", { userId });
                  
                  try {
                    // Get all non-exported insights for this user
                    const insights = await prisma.insight.findMany({
                      where: {
                        transcript: {
                          slack_user_id: userId,
                        },
                        exported: false,
                      },
                      select: {
                        id: true,
                      },
                    });
                    
                    const insightIds = insights.map(i => i.id);
                    
                    if (insightIds.length === 0) {
                      // Send ephemeral message
                      await slack.chat.postEphemeral({
                        channel: userId,
                        user: userId,
                        text: "No new insights to export. All insights have already been exported.",
                      });
                      
                      logger?.info("ℹ️ [App Home] No new insights to export");
                      return c.json({ ok: true });
                    }
                    
                    logger?.info("📋 [App Home] Found insights to export", { count: insightIds.length });
                    
                    // Get the export tool from mastra
                    const { exportAirtableTool } = await import("./tools/exportAirtableTool");
                    
                    // Execute the export tool
                    const result = await exportAirtableTool.execute({
                      context: { insightIds, userId },
                      mastra,
                      runtimeContext: {},
                    });
                    
                    // Send result message
                    await slack.chat.postEphemeral({
                      channel: userId,
                      user: userId,
                      text: result.success 
                        ? `✅ Successfully exported ${result.exportedCount} insight(s) to Airtable!${result.failedCount > 0 ? ` (${result.failedCount} failed)` : ""}`
                        : `❌ Export failed: ${result.error}`,
                    });
                    
                    logger?.info("✅ [App Home] Airtable export completed", {
                      exported: result.exportedCount,
                      failed: result.failedCount,
                    });
                    
                    return c.json({ ok: true });
                  } catch (error) {
                    logger?.error("❌ [App Home] Error exporting to Airtable", {
                      error: error instanceof Error ? error.message : "Unknown error",
                    });
                    
                    await slack.chat.postEphemeral({
                      channel: userId,
                      user: userId,
                      text: `❌ Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                    });
                    
                    return c.json({ ok: false, error: "Export failed" }, 500);
                  }
                  
                } else if (action.action_id === "export_single_insight") {
                  const insightId = action.value;
                  logger?.info("📤 [App Home] Exporting single insight", { userId, insightId });
                  
                  try {
                    // Get the insight to determine which export tool to use
                    const insight = await prisma.insight.findUnique({
                      where: { id: insightId },
                      include: {
                        transcript: true,
                      },
                    });
                    
                    if (!insight) {
                      throw new Error("Insight not found");
                    }
                    
                    // Check for user's default export provider
                    const exportConfig = await prisma.exportConfig.findFirst({
                      where: {
                        user_id: userId,
                        enabled: true,
                      },
                      orderBy: {
                        created_at: "desc",
                      },
                    });
                    
                    if (!exportConfig) {
                      await slack.chat.postEphemeral({
                        channel: userId,
                        user: userId,
                        text: "❌ No export destination configured. Please configure an export destination in Settings.",
                      });
                      return c.json({ ok: true });
                    }
                    
                    logger?.info("📋 [App Home] Using export provider", { provider: exportConfig.provider });
                    
                    // Export based on provider
                    let result;
                    if (exportConfig.provider === "linear") {
                      const { exportLinearTool } = await import("./tools/exportLinearTool");
                      result = await exportLinearTool.execute({
                        context: { insightIds: [insightId], userId },
                        mastra,
                        runtimeContext: {},
                      });
                    } else if (exportConfig.provider === "airtable") {
                      const { exportAirtableTool } = await import("./tools/exportAirtableTool");
                      result = await exportAirtableTool.execute({
                        context: { insightIds: [insightId], userId },
                        mastra,
                        runtimeContext: {},
                      });
                    } else {
                      throw new Error(`Unsupported export provider: ${exportConfig.provider}`);
                    }
                    
                    // Send result message
                    await slack.chat.postEphemeral({
                      channel: userId,
                      user: userId,
                      text: result.success 
                        ? `✅ Successfully exported insight to ${exportConfig.provider}!`
                        : `❌ Export failed: ${result.error}`,
                    });
                    
                    logger?.info("✅ [App Home] Single insight export completed", {
                      provider: exportConfig.provider,
                      success: result.success,
                    });
                    
                    return c.json({ ok: true });
                  } catch (error) {
                    logger?.error("❌ [App Home] Error exporting single insight", {
                      error: error instanceof Error ? error.message : "Unknown error",
                    });
                    
                    await slack.chat.postEphemeral({
                      channel: userId,
                      user: userId,
                      text: `❌ Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                    });
                    
                    return c.json({ ok: false, error: "Export failed" }, 500);
                  }
                }
              }
              
              // Handle message actions (right-click shortcuts)
              if (payload.type === "message_action") {
                const userId = payload.user.id;
                const { slack } = await (await import("../triggers/slackTriggers")).getClient();
                const { getPrisma } = await import("./utils/database");
                const prisma = getPrisma();
                
                if (payload.callback_id === "add_to_meetyai") {
                  logger?.info("📌 [Message Action] User adding message to MeetyAI", {
                    user: userId,
                    messageText: payload.message.text?.substring(0, 100),
                  });
                  
                  try {
                    // Extract message content
                    const messageText = payload.message.text || "";
                    const channel = payload.channel.id;
                    const messageTs = payload.message.ts;
                    
                    // Create transcript record
                    const transcript = await prisma.transcript.create({
                      data: {
                        title: `Transcript from Slack message (${new Date().toLocaleDateString()})`,
                        origin: "paste",
                        status: "file_uploaded",
                        slack_user_id: userId,
                        slack_channel_id: channel,
                        slack_message_ts: messageTs,
                        raw_content: messageText,
                        transcript_text: messageText,
                        language: "en",
                      },
                    });
                    
                    logger?.info("✅ [Message Action] Transcript created from message", {
                      transcriptId: transcript.id,
                    });
                    
                    // Send confirmation to user
                    await slack.chat.postEphemeral({
                      channel,
                      user: userId,
                      text: `✅ Message added to MeetyAI! Analyzing now...`,
                    });
                    
                    // Start analysis workflow
                    const run = await mastra.getWorkflow("metiyWorkflow").createRunAsync();
                    await run.start({
                      inputData: {
                        message: messageText,
                        threadId: `slack-message-action/${Date.now()}`,
                        slackUserId: userId,
                        slackChannel: userId, // DM for results
                        threadTs: undefined,
                      },
                    });
                    
                    logger?.info("✅ [Message Action] Analysis workflow started");
                    return c.json({ ok: true });
                    
                  } catch (error) {
                    logger?.error("❌ [Message Action] Error processing message", {
                      error: error instanceof Error ? error.message : "Unknown error",
                    });
                    
                    await slack.chat.postEphemeral({
                      channel: payload.channel.id,
                      user: userId,
                      text: `❌ Failed to add message to MeetyAI: ${error instanceof Error ? error.message : "Unknown error"}`,
                    });
                    
                    return c.json({ ok: false, error: "Failed to process message" }, 500);
                  }
                }
              }
              
              if (payload.type === "view_submission") {
                const callbackId = payload.view.callback_id;
                const userId = payload.user.id;
                const values = payload.view.state.values;
                
                if (callbackId === "meetyai_analyze_modal") {
                  // Handle transcript analysis submission
                  const transcriptText = values.transcript_text_block?.transcript_text?.value;
                  const transcriptLink = values.transcript_link_block?.transcript_link?.value;
                  
                  if (!transcriptText && !transcriptLink) {
                    return c.json({
                      response_action: "errors",
                      errors: {
                        transcript_text_block: "Please provide either text or a link",
                      },
                    });
                  }
                  
                  // Start analysis workflow
                  const message = transcriptText || `Please analyze the transcript at: ${transcriptLink}`;
                  const threadId = `slack-modal/${Date.now()}`;
                  
                  const run = await mastra.getWorkflow("metiyWorkflow").createRunAsync();
                  await run.start({
                    inputData: {
                      message,
                      threadId,
                      slackUserId: userId,
                      slackChannel: userId, // DM
                      threadTs: undefined,
                    },
                  });
                  
                  logger?.info("✅ [MeetyAI Modal] Analysis started");
                  return c.json({ response_action: "clear" });
                  
                } else if (callbackId === "upload_transcript_modal") {
                  // Handle upload transcript modal submission (from App Home)
                  const transcriptText = values.transcript_text_block?.transcript_text?.value;
                  const transcriptLink = values.transcript_link_block?.transcript_link?.value;
                  
                  if (!transcriptText && !transcriptLink) {
                    return c.json({
                      response_action: "errors",
                      errors: {
                        transcript_text_block: "Please provide either text or a link",
                      },
                    });
                  }
                  
                  logger?.info("📤 [App Home Upload] Processing transcript submission", {
                    hasText: !!transcriptText,
                    hasLink: !!transcriptLink,
                  });
                  
                  // Start analysis workflow
                  const message = transcriptText || `Please analyze the transcript at: ${transcriptLink}`;
                  const threadId = `slack-app-home/${Date.now()}`;
                  
                  const run = await mastra.getWorkflow("metiyWorkflow").createRunAsync();
                  await run.start({
                    inputData: {
                      message,
                      threadId,
                      slackUserId: userId,
                      slackChannel: userId, // DM
                      threadTs: undefined,
                    },
                  });
                  
                  logger?.info("✅ [App Home Upload] Analysis workflow started");
                  return c.json({ response_action: "clear" });
                  
                } else if (callbackId === "meetyai_settings_modal") {
                  // Handle settings submission
                  const modelProvider = values.model_provider_block?.model_provider?.selected_option?.value;
                  const apiKey = values.api_key_block?.api_key?.value;
                  const researchDepth = parseFloat(values.research_depth_block?.research_depth?.selected_option?.value || "0.7");
                  
                  // Save settings to database
                  const { getPrisma } = await import("./utils/database");
                  const prisma = getPrisma();
                  
                  await prisma.userSetting.upsert({
                    where: { user_id: userId },
                    create: {
                      user_id: userId,
                      research_depth: researchDepth,
                    },
                    update: {
                      research_depth: researchDepth,
                    },
                  });
                  
                  // If API key provided, save encrypted
                  if (apiKey && modelProvider) {
                    const { encrypt } = await import("./utils/encryption");
                    const encrypted = encrypt(apiKey);
                    
                    await prisma.modelConfig.upsert({
                      where: {
                        user_id_provider_label: {
                          user_id: userId,
                          provider: modelProvider,
                          label: "default",
                        },
                      },
                      create: {
                        user_id: userId,
                        provider: modelProvider,
                        label: "default",
                        api_key_encrypted: encrypted,
                        is_default: true,
                        model_type: "analysis",
                      },
                      update: {
                        api_key_encrypted: encrypted,
                      },
                    });
                  }
                  
                  logger?.info("✅ [MeetyAI Modal] Settings saved");
                  return c.json({ response_action: "clear" });
                  
                } else if (callbackId === "model_config_modal") {
                  // Handle model configuration submission
                  const { getPrisma } = await import("./utils/database");
                  const { encrypt } = await import("./utils/encryption");
                  const prisma = getPrisma();
                  
                  const provider = values.model_provider?.provider?.selected_option?.value;
                  const modelName = values.model_name?.name?.value;
                  const apiKey = values.api_key?.key?.value;
                  
                  if (!provider) {
                    return c.json({
                      response_action: "errors",
                      errors: {
                        model_provider: "Please select a provider",
                      },
                    });
                  }
                  
                  const encryptedKey = apiKey ? encrypt(apiKey) : "";
                  
                  await prisma.modelConfig.upsert({
                    where: {
                      user_id_provider_label: {
                        user_id: userId,
                        provider,
                        label: "default",
                      },
                    },
                    create: {
                      user_id: userId,
                      provider,
                      label: "default",
                      api_key_encrypted: encryptedKey,
                      model_name: modelName || "",
                      is_default: true,
                      model_type: "analysis",
                    },
                    update: {
                      api_key_encrypted: encryptedKey || undefined,
                      model_name: modelName || "",
                    },
                  });
                  
                  logger?.info("✅ [MeetyAI Modal] Model config saved", { provider, modelName });
                  return c.json({ response_action: "clear" });
                  
                } else if (callbackId === "export_config_modal") {
                  // Handle export configuration submission
                  const { getPrisma } = await import("./utils/database");
                  const { encrypt } = await import("./utils/encryption");
                  const prisma = getPrisma();
                  
                  const provider = values.export_provider?.provider?.selected_option?.value;
                  const enabled = values.export_enabled?.enabled?.selected_option?.value === "true";
                  const apiKey = values.export_api_key?.api_key?.value;
                  const teamId = values.export_team_id?.team_id?.value;
                  const titleField = values.field_mapping_title?.title?.value || "title";
                  const descField = values.field_mapping_description?.description?.value || "description";
                  const minConfidence = parseFloat(values.min_confidence?.confidence?.selected_option?.value || "0.7");
                  const typesFilter = values.types_filter?.types?.selected_options?.map((o: any) => o.value) || [];
                  
                  if (!provider) {
                    return c.json({
                      response_action: "errors",
                      errors: {
                        export_provider: "Please select an export destination",
                      },
                    });
                  }
                  
                  const credentials = apiKey ? JSON.stringify({ api_key: apiKey }) : "";
                  const encryptedCreds = credentials ? encrypt(credentials) : "";
                  
                  const fieldMapping = {
                    title: titleField,
                    description: descField,
                  };
                  
                  await prisma.exportConfig.upsert({
                    where: {
                      id: `${userId}-${provider}`,
                    },
                    create: {
                      id: `${userId}-${provider}`,
                      user_id: userId,
                      provider,
                      label: provider,
                      enabled,
                      credentials_encrypted: encryptedCreds,
                      team_id: teamId,
                      field_mapping: fieldMapping,
                      min_confidence: minConfidence,
                      types_filter: typesFilter,
                    },
                    update: {
                      enabled,
                      credentials_encrypted: encryptedCreds || undefined,
                      team_id: teamId,
                      field_mapping: fieldMapping,
                      min_confidence: minConfidence,
                      types_filter: typesFilter,
                    },
                  });
                  
                  logger?.info("✅ [MeetyAI Modal] Export config saved", { provider, enabled });
                  return c.json({ response_action: "clear" });
                  
                } else if (callbackId === "general_settings_modal") {
                  // Handle general settings submission
                  const { getPrisma } = await import("./utils/database");
                  const prisma = getPrisma();
                  
                  const researchDepth = parseFloat(values.research_depth?.depth?.selected_option?.value || "0.7");
                  const autoApprove = values.auto_approve?.approve?.selected_option?.value === "true";
                  const notifications = values.notifications?.notif?.selected_options?.map((o: any) => o.value) || [];
                  
                  await prisma.userSetting.upsert({
                    where: { user_id: userId },
                    create: {
                      user_id: userId,
                      research_depth: researchDepth,
                      auto_approve: autoApprove,
                      notify_on_completion: notifications.includes("completion"),
                      notify_on_failure: notifications.includes("failure"),
                    },
                    update: {
                      research_depth: researchDepth,
                      auto_approve: autoApprove,
                      notify_on_completion: notifications.includes("completion"),
                      notify_on_failure: notifications.includes("failure"),
                    },
                  });
                  
                  logger?.info("✅ [MeetyAI Modal] General settings saved");
                  return c.json({ response_action: "clear" });
                }
              }
              
              return c.text("OK", 200);
              
            } catch (error) {
              logger?.error("❌ [MeetyAI Modal] Error handling interaction", {
                error: error instanceof Error ? error.message : "Unknown error",
              });
              return c.json({ error: "Failed to process submission" }, 500);
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
