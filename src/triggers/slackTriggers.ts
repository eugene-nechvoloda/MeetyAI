import { format } from "node:util";
import { Mastra, type WorkflowResult, type Step } from "@mastra/core";
import { IMastraLogger } from "@mastra/core/logger";
import {
  type AuthTestResponse,
  type ChatPostMessageResponse,
  type ConversationsOpenResponse,
  type ConversationsRepliesResponse,
  type UsersConversationsResponse,
  type WebAPICallError,
  ErrorCode,
  WebClient,
} from "@slack/web-api";
import type { Context, Handler, MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";

import { registerApiRoute } from "../mastra/inngest";

export type Methods = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL";

// TODO: Remove when Mastra exports this type.
export type ApiRoute =
  | {
      path: string;
      method: Methods;
      handler: Handler;
      middleware?: MiddlewareHandler | MiddlewareHandler[];
    }
  | {
      path: string;
      method: Methods;
      createHandler: ({ mastra }: { mastra: Mastra }) => Promise<Handler>;
      middleware?: MiddlewareHandler | MiddlewareHandler[];
    };

export type TriggerInfoSlackOnNewMessage = {
  type: "slack/message.channels";
  params: {
    channel: string;
    channelDisplayName: string;
  };
  payload: any;
};

type DiagnosisStep =
  | {
      status: "pending";
      name: string;
      extra?: Record<string, any>;
    }
  | {
      status: "success";
      name: string;
      extra: Record<string, any>;
    }
  | {
      status: "failed";
      name: string;
      error: string;
      extra: Record<string, any>;
    };

export async function getClient() {
  let connectionSettings: any;
  async function getAccessToken() {
    if (
      connectionSettings &&
      connectionSettings.settings.expires_at &&
      new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
    ) {
      return {
        token: connectionSettings.settings.access_token,
        user: connectionSettings.settings.oauth?.credentials?.raw?.authed_user
          ?.id,
      };
    }

    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? "depl " + process.env.WEB_REPL_RENEWAL
        : null;

    if (!xReplitToken) {
      throw new Error("X_REPLIT_TOKEN not found for repl/depl");
    }

    const res = await fetch(
      "https://" +
        hostname +
        "/api/v2/connection?include_secrets=true&connector_names=slack-agent",
      {
        headers: {
          Accept: "application/json",
          X_REPLIT_TOKEN: xReplitToken,
        },
      },
    );
    const resJson = await res.json();
    connectionSettings = resJson?.items?.[0];
    if (!connectionSettings || !connectionSettings.settings.access_token) {
      throw new Error(
        `Slack not connected: HTTP ${res.status} ${res.statusText}: ${JSON.stringify(resJson)}`,
      );
    }
    return {
      token: connectionSettings.settings.access_token,
      user: connectionSettings.settings.oauth?.credentials?.raw?.authed_user
        ?.id,
    };
  }

  const { token, user } = await getAccessToken();
  const slack = new WebClient(token);

  const response = await slack.auth.test();

  return { slack, auth: response, user };
}

// Keep up to 200 recent events, to prevent duplicates
const recentEvents: string[] = [];

function isWebAPICallError(err: unknown): err is WebAPICallError {
  return (
    err !== null && typeof err === "object" && "code" in err && "data" in err
  );
}

function checkDuplicateEvent(eventName: string) {
  if (recentEvents.includes(eventName)) {
    return true;
  }
  recentEvents.push(eventName);
  if (recentEvents.length > 200) {
    recentEvents.shift();
  }
  return false;
}

function createReactToMessage<
  TState extends z.ZodObject<any>,
  TInput extends z.ZodType<any>,
  TOutput extends z.ZodType<any>,
  TSteps extends Step<string, any, any>[],
>({ slack, logger }: { slack: WebClient; logger: IMastraLogger }) {
  const addReaction = async (
    channel: string,
    timestamp: string,
    emoji: string,
  ) => {
    logger.info(`[Slack] Adding reaction to message`, {
      emoji,
      timestamp,
      channel,
    });
    try {
      await slack.reactions.add({ channel, timestamp, name: emoji });
    } catch (error) {
      logger.error(`[Slack] Error adding reaction to message`, {
        emoji,
        timestamp,
        channel,
        error: format(error),
      });
    }
  };

  const removeAllReactions = async (channel: string, timestamp: string) => {
    logger.info(`[Slack] Removing all reactions from message`, {
      timestamp,
      channel,
    });
    const emojis = [
      "hourglass",
      "hourglass_flowing_sand",
      "white_check_mark",
      "x",
      "alarm_clock",
    ];

    for (const emoji of emojis) {
      try {
        await slack.reactions.remove({ channel, timestamp, name: emoji });
      } catch (error) {
        if (
          isWebAPICallError(error) &&
          (error.code !== ErrorCode.PlatformError ||
            error.data?.error !== "no_reaction")
        ) {
          logger.error("[Slack] Error removing reaction", {
            emoji,
            timestamp,
            channel,
            error: format(error),
          });
        }
      }
    }
  };

  return async function reactToMessage(
    channel: string,
    timestamp: string,
    result: WorkflowResult<TState, TInput, TOutput, TSteps> | null,
  ) {
    // Remove all of our reactions.
    await removeAllReactions(channel, timestamp);
    if (result?.status === "success") {
      await addReaction(channel, timestamp, "white_check_mark");
    } else if (result?.status === "failed") {
      await addReaction(channel, timestamp, "x");
    } else if (result !== null) {
      await addReaction(channel, timestamp, "alarm_clock");
    }
  };
}

async function handleInteractivePayload(
  c: any,
  payload: any,
  logger: any
): Promise<Response> {
  const { slack } = await getClient();
  const userId = payload.user?.id;
  const actionId = payload.actions?.[0]?.action_id;
  
  logger?.info("🔘 [Slack] Handling interactive action", { actionId, userId });
  
  try {
    // Import App Home view builders
    const { 
      buildHomeTab, 
      buildTranscriptsTab, 
      buildInsightsTab,
      buildUploadTranscriptModal,
      buildExportSettingsModal 
    } = await import("../mastra/ui/appHomeViews");
    
    // Handle tab navigation
    if (actionId === "switch_to_home_tab") {
      const view = await buildHomeTab(userId);
      await slack.views.publish({ user_id: userId, view: view as any });
      logger?.info("✅ [Slack] Switched to Home tab");
      return c.text("", 200);
    }
    
    if (actionId === "switch_to_transcripts_tab") {
      const view = await buildTranscriptsTab(userId);
      await slack.views.publish({ user_id: userId, view: view as any });
      logger?.info("✅ [Slack] Switched to Transcripts tab");
      return c.text("", 200);
    }
    
    if (actionId === "switch_to_insights_tab") {
      const view = await buildInsightsTab(userId);
      await slack.views.publish({ user_id: userId, view: view as any });
      logger?.info("✅ [Slack] Switched to Insights tab");
      return c.text("", 200);
    }
    
    // Handle Re-analyze Transcript button - trigger workflow to re-analyze
    if (actionId === "reanalyze_transcript") {
      const transcriptId = payload.actions?.[0]?.value;
      logger?.info("🔄 [Slack] Re-analyze transcript requested", { transcriptId, userId });
      
      try {
        const { getPrismaAsync } = await import("../mastra/utils/database");
        const prisma = await getPrismaAsync();
        
        // Get the transcript
        const transcript = await prisma.transcript.findUnique({
          where: { id: transcriptId },
        });
        
        if (!transcript) {
          await slack.chat.postMessage({
            channel: userId,
            text: "❌ Transcript not found. Please try again.",
          });
          return c.text("", 200);
        }
        
        // Send immediate feedback
        await slack.chat.postMessage({
          channel: userId,
          text: `🔄 *Re-analyzing transcript: ${transcript.title}*\n\nThis may take a minute. I'll notify you when the analysis is complete.`,
        });
        
        // Trigger the workflow to re-analyze
        const { mastra: mastraInstance } = await import("../mastra/index");
        const threadId = `transcript/${transcript.id}`;
        const message = `Re-analyze transcript "${transcript.title}" (ID: ${transcript.id}):\n\n${transcript.transcript_text}`;
        
        const run = await mastraInstance.getWorkflow("metiyWorkflow").createRunAsync();
        await run.start({
          inputData: {
            message,
            threadId,
            slackUserId: userId,
            slackChannel: userId,
            threadTs: undefined,
            transcriptId: transcript.id,
          },
        });
        
        logger?.info("✅ [Slack] Re-analysis triggered", { transcriptId, threadId });
        
        // Log the activity
        await prisma.transcriptActivity.create({
          data: {
            transcript_id: transcript.id,
            activity_type: "reanalysis_started",
            message: "Re-analysis triggered by user",
          },
        });
        
        // Update the view to show pending status
        const view = await buildTranscriptsTab(userId);
        await slack.views.publish({ user_id: userId, view: view as any });
        
        return c.text("", 200);
      } catch (error) {
        logger?.error("❌ [Slack] Re-analysis failed", { error: format(error), transcriptId });
        await slack.chat.postMessage({
          channel: userId,
          text: "❌ Failed to start re-analysis. Please try again.",
        });
        return c.text("", 200);
      }
    }
    
    // Handle Archive Transcript button
    if (actionId === "archive_transcript") {
      const transcriptId = payload.actions?.[0]?.value;
      logger?.info("🗑️ [Slack] Archive transcript requested", { transcriptId, userId });
      
      try {
        const { getPrismaAsync } = await import("../mastra/utils/database");
        const prisma = await getPrismaAsync();
        
        // Get the transcript
        const transcript = await prisma.transcript.findUnique({
          where: { id: transcriptId },
        });
        
        if (!transcript) {
          await slack.chat.postMessage({
            channel: userId,
            text: "❌ Transcript not found.",
          });
          return c.text("", 200);
        }
        
        // Archive the transcript
        await prisma.transcript.update({
          where: { id: transcriptId },
          data: {
            archived: true,
            archived_at: new Date(),
          },
        });
        
        // Archive all related insights (set both archived flag and status)
        await prisma.insight.updateMany({
          where: { transcript_id: transcriptId },
          data: {
            archived: true,
            archived_at: new Date(),
            status: "archived",
          },
        });
        
        // Log the activity
        await prisma.transcriptActivity.create({
          data: {
            transcript_id: transcriptId,
            activity_type: "archived",
            message: "Transcript archived by user",
          },
        });
        
        logger?.info("✅ [Slack] Transcript archived", { transcriptId, title: transcript.title });
        
        // Send confirmation DM
        await slack.chat.postMessage({
          channel: userId,
          text: `🗑️ Transcript "*${transcript.title}*" has been archived.\n\nThe transcript and its insights are now hidden from your lists.`,
        });
        
        // Refresh the Transcripts tab
        const view = await buildTranscriptsTab(userId);
        await slack.views.publish({ user_id: userId, view: view as any });
        
        return c.text("", 200);
      } catch (error) {
        logger?.error("❌ [Slack] Archive failed", { error: format(error), transcriptId });
        await slack.chat.postMessage({
          channel: userId,
          text: "❌ Failed to archive transcript. Please try again.",
        });
        return c.text("", 200);
      }
    }
    
    // Handle Upload Transcript button - open modal
    if (actionId === "open_upload_transcript_modal") {
      const modal = buildUploadTranscriptModal();
      await slack.views.open({
        trigger_id: payload.trigger_id,
        view: modal as any,
      });
      logger?.info("✅ [Slack] Opened upload transcript modal");
      return c.text("", 200);
    }
    
    // Handle Settings button - open export settings modal
    if (actionId === "open_export_settings") {
      const modal = await buildExportSettingsModal(userId);
      await slack.views.open({
        trigger_id: payload.trigger_id,
        view: modal as any,
      });
      logger?.info("✅ [Slack] Opened export settings modal");
      return c.text("", 200);
    }
    
    // Handle Configure Linear button (from Settings hub)
    if (actionId === "configure_linear") {
      const { buildLinearConfigModal } = await import("../mastra/ui/appHomeViews");
      const { getPrismaAsync } = await import("../mastra/utils/database");
      const prisma = await getPrismaAsync();
      
      const existingConfig = await prisma.exportConfig.findFirst({
        where: { user_id: userId, provider: "linear" },
      });
      
      const modal = buildLinearConfigModal(existingConfig);
      await slack.views.push({
        trigger_id: payload.trigger_id,
        view: modal as any,
      });
      logger?.info("✅ [Slack] Opened Linear config modal");
      return c.text("", 200);
    }
    
    // Handle Configure Airtable button (from Settings hub)
    if (actionId === "configure_airtable") {
      const { buildAirtableConfigModal } = await import("../mastra/ui/appHomeViews");
      const { getPrismaAsync } = await import("../mastra/utils/database");
      const prisma = await getPrismaAsync();
      
      const existingConfig = await prisma.exportConfig.findFirst({
        where: { user_id: userId, provider: "airtable" },
      });
      
      const modal = buildAirtableConfigModal(existingConfig);
      await slack.views.push({
        trigger_id: payload.trigger_id,
        view: modal as any,
      });
      logger?.info("✅ [Slack] Opened Airtable config modal");
      return c.text("", 200);
    }
    
    // Handle Configure Zoom button (from Settings hub)
    if (actionId === "configure_zoom") {
      const { buildZoomConfigModal } = await import("../mastra/ui/appHomeViews");
      const { getPrismaAsync } = await import("../mastra/utils/database");
      const prisma = await getPrismaAsync();
      
      // Zoom uses ImportSource table, not ExportConfig
      const existingConfig = await prisma.importSource.findFirst({
        where: { user_id: userId, provider: "zoom" },
      });
      
      const modal = buildZoomConfigModal(existingConfig);
      await slack.views.push({
        trigger_id: payload.trigger_id,
        view: modal as any,
      });
      logger?.info("✅ [Slack] Opened Zoom config modal");
      return c.text("", 200);
    }
    
    // Handle Configure Field Mapping button (from Settings hub)
    if (actionId === "configure_field_mapping") {
      const { buildFieldMappingModal } = await import("../mastra/ui/appHomeViews");
      const modal = await buildFieldMappingModal(userId);
      await slack.views.push({
        trigger_id: payload.trigger_id,
        view: modal as any,
      });
      logger?.info("✅ [Slack] Opened field mapping modal");
      return c.text("", 200);
    }
    
    // Handle Export to Linear button
    if (actionId === "export_all_linear") {
      logger?.info("📤 [Slack] Export to Linear triggered", { userId });
      
      try {
        const { getPrismaAsync } = await import("../mastra/utils/database");
        const prisma = await getPrismaAsync();
        
        // Check if Linear is configured
        const config = await prisma.exportConfig.findFirst({
          where: { user_id: userId, provider: "linear", enabled: true },
        });
        
        if (!config) {
          await slack.chat.postMessage({
            channel: userId,
            text: "⚠️ Linear is not configured yet.\n\nTo export insights to Linear, please:\n1. Click *Export Settings* on the Insights tab\n2. Configure your Linear API key and team settings",
          });
          return c.text("", 200);
        }
        
        // Get unexported insights for this user (excluding archived)
        const insights = await prisma.insight.findMany({
          where: {
            transcript: { 
              slack_user_id: userId,
              archived: false,
            },
            archived: false,
            exported: false,
          },
          select: { id: true },
        });
        
        if (insights.length === 0) {
          await slack.chat.postMessage({
            channel: userId,
            text: "ℹ️ No new insights to export. All your insights have already been exported to Linear.",
          });
          return c.text("", 200);
        }
        
        // Execute export via the tool
        const { exportLinearTool } = await import("../mastra/tools/exportLinearTool");
        const { mastra } = await import("../mastra/index");
        const insightIds = insights.map((i: { id: string }) => i.id);
        const result = await exportLinearTool.execute({
          context: { insightIds, userId },
          mastra,
          runtimeContext: {} as any,
        });
        
        if (result.success) {
          await slack.chat.postMessage({
            channel: userId,
            text: `✅ Successfully exported ${result.exportedCount} insight(s) to Linear!${result.failedCount > 0 ? `\n⚠️ ${result.failedCount} insight(s) failed to export.` : ""}`,
          });
        } else {
          await slack.chat.postMessage({
            channel: userId,
            text: `❌ Export failed: ${result.error}`,
          });
        }
        
        logger?.info("✅ [Slack] Linear export completed", result);
        return c.text("", 200);
      } catch (error) {
        logger?.error("❌ [Slack] Linear export error", { error: format(error) });
        await slack.chat.postMessage({
          channel: userId,
          text: "❌ An error occurred while exporting to Linear. Please try again.",
        });
        return c.text("", 200);
      }
    }
    
    // Handle Export to Airtable button
    if (actionId === "export_all_airtable") {
      logger?.info("📤 [Slack] Export to Airtable triggered", { userId });
      
      try {
        const { getPrismaAsync } = await import("../mastra/utils/database");
        const prisma = await getPrismaAsync();
        
        // Check if Airtable is configured
        const config = await prisma.exportConfig.findFirst({
          where: { user_id: userId, provider: "airtable", enabled: true },
        });
        
        if (!config) {
          await slack.chat.postMessage({
            channel: userId,
            text: "⚠️ Airtable is not configured yet.\n\nTo export insights to Airtable, please:\n1. Click *Export Settings* on the Insights tab\n2. Configure your Airtable API key and base settings",
          });
          return c.text("", 200);
        }
        
        // Get unexported insights for this user (excluding archived)
        const insights = await prisma.insight.findMany({
          where: {
            transcript: { 
              slack_user_id: userId,
              archived: false,
            },
            archived: false,
            exported: false,
          },
          select: { id: true },
        });
        
        if (insights.length === 0) {
          await slack.chat.postMessage({
            channel: userId,
            text: "ℹ️ No new insights to export. All your insights have already been exported to Airtable.",
          });
          return c.text("", 200);
        }
        
        // Execute export via the tool
        const { exportAirtableTool } = await import("../mastra/tools/exportAirtableTool");
        const { mastra } = await import("../mastra/index");
        const insightIds = insights.map((i: { id: string }) => i.id);
        const result = await exportAirtableTool.execute({
          context: { insightIds, userId },
          mastra,
          runtimeContext: {} as any,
        });
        
        if (result.success) {
          await slack.chat.postMessage({
            channel: userId,
            text: `✅ Successfully exported ${result.exportedCount} insight(s) to Airtable!${result.failedCount > 0 ? `\n⚠️ ${result.failedCount} insight(s) failed to export.` : ""}`,
          });
        } else {
          await slack.chat.postMessage({
            channel: userId,
            text: `❌ Export failed: ${result.error}`,
          });
        }
        
        logger?.info("✅ [Slack] Airtable export completed", result);
        return c.text("", 200);
      } catch (error) {
        logger?.error("❌ [Slack] Airtable export error", { error: format(error) });
        await slack.chat.postMessage({
          channel: userId,
          text: "❌ An error occurred while exporting to Airtable. Please try again.",
        });
        return c.text("", 200);
      }
    }
    
    // Handle modal submissions
    if (payload.type === "view_submission") {
      const callbackId = payload.view?.callback_id;
      logger?.info("📝 [Slack] Modal submission", { callbackId });
      
      if (callbackId === "upload_transcript_modal") {
        const values = payload.view?.state?.values;
        const transcriptText = values?.transcript_input?.transcript_text?.value;
        const title = values?.title_input?.title_text?.value || "Untitled Transcript";
        const fileInfo = values?.file_input?.transcript_file?.files?.[0];
        
        logger?.info("📄 [Slack] Transcript submission received", { 
          title,
          textLength: transcriptText?.length || 0,
          hasFile: !!fileInfo,
          fileName: fileInfo?.name,
          fileType: fileInfo?.filetype,
        });
        
        try {
          const { ingestTranscript } = await import("../mastra/services/transcriptIngestion");
          const { TranscriptOrigin } = await import("@prisma/client");
          
          let content = "";
          let origin: typeof TranscriptOrigin[keyof typeof TranscriptOrigin] = TranscriptOrigin.paste;
          let metadata: any = {};
          
          if (fileInfo) {
            logger?.info("📎 [Slack] Processing file upload", {
              fileId: fileInfo.id,
              fileName: fileInfo.name,
              url: fileInfo.url_private,
            });
            
            const fileResponse = await fetch(fileInfo.url_private, {
              headers: {
                Authorization: `Bearer ${(await getClient()).slack.token}`,
              },
            });
            
            if (fileResponse.ok) {
              content = await fileResponse.text();
              origin = TranscriptOrigin.file_upload;
              metadata = {
                fileName: fileInfo.name,
                fileType: fileInfo.filetype,
              };
              logger?.info("✅ [Slack] File content downloaded", {
                contentLength: content.length,
              });
            } else {
              logger?.error("❌ [Slack] Failed to download file", {
                status: fileResponse.status,
              });
              return c.json({
                response_action: "errors",
                errors: {
                  file_input: "Failed to download file. Please try again or paste the text directly.",
                },
              });
            }
          } else if (transcriptText) {
            content = transcriptText;
            origin = TranscriptOrigin.paste;
          } else {
            return c.json({
              response_action: "errors",
              errors: {
                transcript_input: "Please either upload a file or paste transcript text.",
              },
            });
          }
          
          const result = await ingestTranscript({
            title,
            content,
            origin,
            slackUserId: userId,
            metadata,
          }, logger);
          
          if (result.success) {
            logger?.info("✅ [Slack] Transcript ingested successfully", {
              transcriptId: result.transcriptId,
              title,
            });
            
            await slack.chat.postMessage({
              channel: userId,
              text: `✅ Transcript "${title}" uploaded successfully!\n\nYour transcript is being processed. You'll find the insights in the *Insights* tab once the analysis is complete.`,
            });
            
            return c.json({ response_action: "clear" });
          } else {
            logger?.error("❌ [Slack] Ingestion failed", { error: result.error });
            return c.json({
              response_action: "errors",
              errors: {
                transcript_input: `Failed to save transcript: ${result.error}`,
              },
            });
          }
        } catch (error) {
          logger?.error("❌ [Slack] Error processing transcript submission", {
            error: format(error),
          });
          return c.json({
            response_action: "errors",
            errors: {
              transcript_input: "An error occurred. Please try again.",
            },
          });
        }
      }
      
      if (callbackId === "export_settings_modal") {
        const values = payload.view?.state?.values;
        logger?.info("⚙️ [Slack] Export settings saved", { values });
        
        try {
          const { getPrismaAsync } = await import("../mastra/utils/database");
          const prisma = await getPrismaAsync();
          
          const selectedTypes = values?.insight_types_selection?.selected_insight_types?.selected_options?.map(
            (opt: any) => opt.value
          ) || [];
          const confidenceValue = parseInt(values?.confidence_threshold?.confidence_value?.value || "50", 10);
          
          await prisma.userSetting.upsert({
            where: { user_id: userId },
            create: {
              user_id: userId,
              research_depth: confidenceValue / 100,
            },
            update: {
              research_depth: confidenceValue / 100,
            },
          });
          
          logger?.info("✅ [Slack] User settings saved", {
            userId,
            selectedTypes,
            confidenceValue,
          });
          
          return c.json({ response_action: "clear" });
        } catch (error) {
          logger?.error("❌ [Slack] Error saving settings", {
            error: format(error),
          });
          return c.json({ response_action: "clear" });
        }
      }
      
      // Handle Linear configuration modal submission
      if (callbackId === "linear_config_modal") {
        const values = payload.view?.state?.values;
        logger?.info("🔧 [Slack] Linear config submission received");
        
        try {
          const { getPrismaAsync } = await import("../mastra/utils/database");
          const { encrypt, validateEncryptionKey } = await import("../mastra/utils/encryption");
          const prisma = await getPrismaAsync();
          
          // Validate encryption key is available
          if (!validateEncryptionKey()) {
            logger?.error("❌ [Slack] Encryption key not configured");
            return c.json({
              response_action: "errors",
              errors: {
                linear_api_key: "System configuration error. Please contact support.",
              },
            });
          }
          
          const apiKey = values?.linear_api_key?.api_key_input?.value;
          const teamId = values?.linear_team_id?.team_id_input?.value;
          const label = values?.linear_label?.label_input?.value || "My Linear Workspace";
          
          if (!apiKey || !teamId) {
            return c.json({
              response_action: "errors",
              errors: {
                linear_api_key: !apiKey ? "API key is required" : undefined,
                linear_team_id: !teamId ? "Team ID is required" : undefined,
              },
            });
          }
          
          // Encrypt credentials
          const encryptedCredentials = encrypt(JSON.stringify({ api_key: apiKey }));
          
          // Find existing config or create new
          const existingConfig = await prisma.exportConfig.findFirst({
            where: { user_id: userId, provider: "linear" },
          });
          
          if (existingConfig) {
            await prisma.exportConfig.update({
              where: { id: existingConfig.id },
              data: {
                label,
                enabled: true,
                credentials_encrypted: encryptedCredentials,
                team_id: teamId,
              },
            });
          } else {
            await prisma.exportConfig.create({
              data: {
                user_id: userId,
                provider: "linear",
                label,
                enabled: true,
                credentials_encrypted: encryptedCredentials,
                team_id: teamId,
                field_mapping: { title: "title", description: "description" },
              },
            });
          }
          
          logger?.info("✅ [Slack] Linear config saved", { userId, teamId });
          
          await slack.chat.postMessage({
            channel: userId,
            text: "✅ Linear has been configured successfully! You can now export insights to Linear.",
          });
          
          return c.json({ response_action: "clear" });
        } catch (error) {
          logger?.error("❌ [Slack] Error saving Linear config", { error: format(error) });
          return c.json({
            response_action: "errors",
            errors: {
              linear_api_key: "Failed to save configuration. Please try again.",
            },
          });
        }
      }
      
      // Handle Airtable configuration modal submission
      if (callbackId === "airtable_config_modal") {
        const values = payload.view?.state?.values;
        logger?.info("🔧 [Slack] Airtable config submission received");
        
        try {
          const { getPrismaAsync } = await import("../mastra/utils/database");
          const { encrypt, validateEncryptionKey } = await import("../mastra/utils/encryption");
          const prisma = await getPrismaAsync();
          
          // Validate encryption key is available
          if (!validateEncryptionKey()) {
            logger?.error("❌ [Slack] Encryption key not configured");
            return c.json({
              response_action: "errors",
              errors: {
                airtable_api_key: "System configuration error. Please contact support.",
              },
            });
          }
          
          const apiKey = values?.airtable_api_key?.api_key_input?.value;
          const baseId = values?.airtable_base_id?.base_id_input?.value;
          const tableName = values?.airtable_table_name?.table_name_input?.value || "Insights";
          const label = values?.airtable_label?.label_input?.value || "My Airtable Base";
          
          if (!apiKey || !baseId) {
            return c.json({
              response_action: "errors",
              errors: {
                airtable_api_key: !apiKey ? "API key is required" : undefined,
                airtable_base_id: !baseId ? "Base ID is required" : undefined,
              },
            });
          }
          
          // Encrypt credentials
          const encryptedCredentials = encrypt(JSON.stringify({ 
            api_key: apiKey,
            base_id: baseId,
            table_name: tableName,
          }));
          
          // Find existing config or create new
          const existingConfig = await prisma.exportConfig.findFirst({
            where: { user_id: userId, provider: "airtable" },
          });
          
          if (existingConfig) {
            await prisma.exportConfig.update({
              where: { id: existingConfig.id },
              data: {
                label,
                enabled: true,
                credentials_encrypted: encryptedCredentials,
                base_id: baseId,
                table_name: tableName,
              },
            });
          } else {
            await prisma.exportConfig.create({
              data: {
                user_id: userId,
                provider: "airtable",
                label,
                enabled: true,
                credentials_encrypted: encryptedCredentials,
                base_id: baseId,
                table_name: tableName,
                field_mapping: { title: "Title", description: "Description" },
              },
            });
          }
          
          logger?.info("✅ [Slack] Airtable config saved", { userId, baseId });
          
          await slack.chat.postMessage({
            channel: userId,
            text: "✅ Airtable has been configured successfully! You can now export insights to Airtable.",
          });
          
          return c.json({ response_action: "clear" });
        } catch (error) {
          logger?.error("❌ [Slack] Error saving Airtable config", { error: format(error) });
          return c.json({
            response_action: "errors",
            errors: {
              airtable_api_key: "Failed to save configuration. Please try again.",
            },
          });
        }
      }
      
      // Handle Zoom configuration modal submission
      if (callbackId === "zoom_config_modal") {
        const values = payload.view?.state?.values;
        logger?.info("🔧 [Slack] Zoom config submission received");
        
        try {
          const { getPrismaAsync } = await import("../mastra/utils/database");
          const { encrypt, validateEncryptionKey } = await import("../mastra/utils/encryption");
          const prisma = await getPrismaAsync();
          
          // Validate encryption key is available
          if (!validateEncryptionKey()) {
            logger?.error("❌ [Slack] Encryption key not configured");
            return c.json({
              response_action: "errors",
              errors: {
                zoom_account_id: "System configuration error. Please contact support.",
              },
            });
          }
          
          const accountId = values?.zoom_account_id?.account_id_input?.value;
          const clientId = values?.zoom_client_id?.client_id_input?.value;
          const clientSecret = values?.zoom_client_secret?.client_secret_input?.value;
          
          if (!accountId || !clientId || !clientSecret) {
            return c.json({
              response_action: "errors",
              errors: {
                zoom_account_id: !accountId ? "Account ID is required" : undefined,
                zoom_client_id: !clientId ? "Client ID is required" : undefined,
                zoom_client_secret: !clientSecret ? "Client Secret is required" : undefined,
              },
            });
          }
          
          // Encrypt credentials (don't log actual values!)
          const encryptedCredentials = encrypt(JSON.stringify({ 
            account_id: accountId,
            client_id: clientId,
            client_secret: clientSecret,
          }));
          
          // Zoom uses ImportSource table
          const existingConfig = await prisma.importSource.findFirst({
            where: { user_id: userId, provider: "zoom" },
          });
          
          if (existingConfig) {
            await prisma.importSource.update({
              where: { id: existingConfig.id },
              data: {
                enabled: true,
                credentials_encrypted: encryptedCredentials,
              },
            });
          } else {
            await prisma.importSource.create({
              data: {
                user_id: userId,
                provider: "zoom",
                label: "Zoom Meeting Transcripts",
                enabled: true,
                credentials_encrypted: encryptedCredentials,
                schedule: "0 * * * *", // Hourly
              },
            });
          }
          
          logger?.info("✅ [Slack] Zoom config saved", { userId });
          
          await slack.chat.postMessage({
            channel: userId,
            text: "✅ Zoom has been configured successfully! MeetyAI will automatically import your meeting transcripts every hour.",
          });
          
          return c.json({ response_action: "clear" });
        } catch (error) {
          logger?.error("❌ [Slack] Error saving Zoom config", { error: format(error) });
          return c.json({
            response_action: "errors",
            errors: {
              zoom_account_id: "Failed to save configuration. Please try again.",
            },
          });
        }
      }
      
      // Handle Field Mapping modal submission
      if (callbackId === "field_mapping_modal") {
        const values = payload.view?.state?.values;
        logger?.info("🔧 [Slack] Field mapping submission", { values });
        
        try {
          const { getPrismaAsync } = await import("../mastra/utils/database");
          const prisma = await getPrismaAsync();
          
          // Get all configs and update their field mappings
          const configs = await prisma.exportConfig.findMany({
            where: { user_id: userId },
          });
          
          for (const config of configs) {
            const newMapping: Record<string, string> = {};
            
            if (config.provider === "linear") {
              const titleField = values?.[`linear_title_field_${config.id}`]?.field_input?.value;
              const descField = values?.[`linear_description_field_${config.id}`]?.field_input?.value;
              if (titleField) newMapping.title = titleField;
              if (descField) newMapping.description = descField;
            }
            
            if (config.provider === "airtable") {
              const titleField = values?.[`airtable_title_field_${config.id}`]?.field_input?.value;
              const descField = values?.[`airtable_description_field_${config.id}`]?.field_input?.value;
              const typeField = values?.[`airtable_type_field_${config.id}`]?.field_input?.value;
              if (titleField) newMapping.title = titleField;
              if (descField) newMapping.description = descField;
              if (typeField) newMapping.type = typeField;
            }
            
            if (Object.keys(newMapping).length > 0) {
              await prisma.exportConfig.update({
                where: { id: config.id },
                data: { field_mapping: newMapping },
              });
            }
          }
          
          logger?.info("✅ [Slack] Field mappings saved", { userId });
          
          await slack.chat.postMessage({
            channel: userId,
            text: "✅ Field mappings have been updated!",
          });
          
          return c.json({ response_action: "clear" });
        } catch (error) {
          logger?.error("❌ [Slack] Error saving field mappings", { error: format(error) });
          return c.json({ response_action: "clear" });
        }
      }
    }
    
    logger?.info("📝 [Slack] Unhandled action", { actionId, type: payload.type });
    return c.text("", 200);
    
  } catch (error) {
    logger?.error("❌ [Slack] Error handling interactive payload", {
      error: format(error),
      actionId,
    });
    return c.text("", 200);
  }
}

export function registerSlackTrigger<
  Env extends { Variables: { mastra: Mastra } },
  TState extends z.ZodObject<any>,
  TInput extends z.ZodType<any>,
  TOutput extends z.ZodType<any>,
  TSteps extends Step<string, any, any>[],
>({
  triggerType,
  handler,
}: {
  triggerType: string;
  handler: (
    mastra: Mastra,
    triggerInfo: TriggerInfoSlackOnNewMessage,
  ) => Promise<WorkflowResult<TState, TInput, TOutput, TSteps> | null>;
}): Array<ApiRoute> {
  return [
    registerApiRoute("/webhooks/slack/action", {
      method: "POST",
      handler: async (c) => {
        const mastra = c.get("mastra");
        const logger = mastra.getLogger();
        try {
          const contentType = c.req.header("content-type") || "";
          let payload: any;
          
          // Handle URL-encoded form data (interactive components like buttons)
          if (contentType.includes("application/x-www-form-urlencoded")) {
            const formData = await c.req.formData();
            const payloadString = formData.get("payload");
            if (payloadString && typeof payloadString === "string") {
              payload = JSON.parse(payloadString);
              logger?.info("📝 [Slack] Interactive payload received", { payload });
              
              // Handle interactive actions (button clicks, etc.)
              return await handleInteractivePayload(c, payload, logger);
            }
            return c.text("OK", 200);
          }
          
          // Handle JSON payloads (Events API)
          payload = await c.req.json();
          const { slack, auth } = await getClient();
          const reactToMessage = createReactToMessage({ slack, logger });

          // Handle challenge
          if (payload && payload["challenge"]) {
            return c.text(payload["challenge"], 200);
          }

          logger?.info("📝 [Slack] payload", { payload });

          // Handle app_home_opened event - show App Home with tabs
          if (payload.event?.type === "app_home_opened") {
            logger?.info("🏠 [Slack App Home] User opened App Home", {
              user: payload.event.user,
              tab: payload.event.tab,
            });
            
            try {
              const userId = payload.event.user;
              const tab = payload.event.tab || "home";
              
              // Skip messages tab - not our view
              if (tab === "messages") {
                return c.text("OK", 200);
              }
              
              // Import App Home view builders
              const { buildHomeTab } = await import("../mastra/ui/appHomeViews");
              
              // Build and publish the Home view with tabs
              const view = await buildHomeTab(userId);
              
              await slack.views.publish({
                user_id: userId,
                view: view as any,
              });
              
              logger?.info("✅ [Slack App Home] View published successfully");
              return c.text("OK", 200);
            } catch (error) {
              logger?.error("❌ [Slack App Home] Error publishing view", {
                error: format(error),
              });
              return c.text("OK", 200); // Still return OK to acknowledge the event
            }
          }

          // Augment event with channel info
          if (payload && payload.event && payload.event.channel) {
            try {
              const result = await slack.conversations.info({
                channel: payload.event.channel,
              });
              logger?.info("📝 [Slack] result", { result });
              payload.channel = result.channel;
            } catch (error) {
              logger?.error("Error fetching channel info", {
                error: format(error),
              });
              // Continue processing even if channel info fetch fails
            }
          }

          // Check subtype
          if (
            payload.event?.subtype === "message_changed" ||
            payload.event?.subtype === "message_deleted"
          ) {
            return c.text("OK", 200);
          }

          if (
            (payload.event?.channel_type === "im" &&
              payload.event?.text === "test:ping") ||
            payload.event?.text === `<@${auth.user_id}> test:ping`
          ) {
            // This is a test message to the bot saying just "test:ping", or a mention that contains "test:ping".
            // We'll reply in the same thread.
            await slack.chat.postMessage({
              channel: payload.event.channel,
              text: "pong",
              thread_ts: payload.event.ts,
            });
            logger?.info("📝 [Slack] pong");
            return c.text("OK", 200);
          }

          if (payload.event?.bot_id) {
            return c.text("OK", 200);
          }

          if (checkDuplicateEvent(payload.event_id)) {
            return c.text("OK", 200);
          }

          const result = await handler(mastra, {
            type: triggerType,
            params: {
              channel: payload.event.channel,
              channelDisplayName: payload.channel.name,
            },
            payload,
          } as TriggerInfoSlackOnNewMessage);

          await reactToMessage(payload.event.channel, payload.event.ts, result);

          return c.text("OK", 200);
        } catch (error) {
          logger?.error("Error handling Slack webhook", {
            error: format(error),
          });
          return c.text("Internal Server Error", 500);
        }
      },
    }),
    {
      path: "/test/slack",
      method: "GET",
      handler: async (c: Context<Env>) => {
        return streamSSE(c, async (stream) => {
          let id = 1;
          const mastra = c.get("mastra");
          const logger = mastra.getLogger() ?? {
            info: console.log,
            error: console.error,
          };

          let diagnosisStepAuth: DiagnosisStep = {
            status: "pending",
            name: "authentication with Slack",
          };
          let diagnosisStepConversation: DiagnosisStep = {
            status: "pending",
            name: "open a conversation with user",
          };
          let diagnosisStepPostMessage: DiagnosisStep = {
            status: "pending",
            name: "send a message to the user",
          };
          let diagnosisStepReadReplies: DiagnosisStep = {
            status: "pending",
            name: "read replies from bot",
          };
          const updateDiagnosisSteps = async (event: string) =>
            stream.writeSSE({
              data: JSON.stringify([
                diagnosisStepAuth,
                diagnosisStepConversation,
                diagnosisStepPostMessage,
                diagnosisStepReadReplies,
              ]),
              event,
              id: String(id++),
            });

          let slack: WebClient;
          let auth: AuthTestResponse;
          let user: string | undefined;
          try {
            ({ slack, auth, user } = await getClient());
          } catch (error) {
            logger?.error("❌ [Slack] test:auth failed", {
              error: format(error),
            });
            diagnosisStepAuth = {
              ...diagnosisStepAuth,
              status: "failed",
              error: "authentication failed",
              extra: { error: format(error) },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          if (!auth?.user_id) {
            logger?.error("❌ [Slack] test:auth not working", {
              auth,
            });
            diagnosisStepAuth = {
              ...diagnosisStepAuth,
              status: "failed",
              error: "authentication failed",
              extra: { auth },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          diagnosisStepAuth = {
            ...diagnosisStepAuth,
            status: "success",
            extra: { auth },
          };
          await updateDiagnosisSteps("progress");

          logger?.info("📝 [Slack] test:auth found", { auth });

          let channel: ConversationsOpenResponse["channel"];
          if (user) {
            // Open a DM with itself.
            let conversationsResponse: ConversationsOpenResponse;
            try {
              conversationsResponse = await slack.conversations.open({
                users: user,
              });
            } catch (error) {
              logger?.error("❌ [Slack] test:conversation not found", {
                error: format(error),
              });
              diagnosisStepConversation = {
                ...diagnosisStepConversation,
                status: "failed",
                error: "opening a conversation failed",
                extra: { error: format(error) },
              };
              await updateDiagnosisSteps("error");
              return;
            }

            if (!conversationsResponse?.channel?.id) {
              logger?.error("❌ [Slack] test:conversation not found", {
                conversationsResponse,
              });
              diagnosisStepConversation = {
                ...diagnosisStepConversation,
                status: "failed",
                error: "conversation channel not found",
                extra: { conversationsResponse },
              };
              await updateDiagnosisSteps("error");
              return;
            }

            channel = conversationsResponse.channel;
          } else {
            // Find the first channel where the bot is installed.
            let conversationsResponse: UsersConversationsResponse;
            try {
              conversationsResponse = await slack.users.conversations({
                user: auth.user_id,
              });
            } catch (error) {
              logger?.error("❌ [Slack] test:conversation not found", {
                error: format(error),
              });
              diagnosisStepConversation = {
                ...diagnosisStepConversation,
                status: "failed",
                error: "opening a conversation failed",
                extra: { error: format(error) },
              };
              await updateDiagnosisSteps("error");
              return;
            }

            if (!conversationsResponse?.channels?.length) {
              logger?.error("❌ [Slack] test:channel not found", {
                conversationsResponse,
              });
              diagnosisStepConversation = {
                ...diagnosisStepConversation,
                status: "failed",
                error: "channel not found",
                extra: { conversationsResponse },
              };
              await updateDiagnosisSteps("error");
              return;
            }
            channel = conversationsResponse.channels![0]!;
          }

          if (!channel.id) {
            logger?.error("❌ [Slack] test:channel not found", {
              channel,
            });
            diagnosisStepConversation = {
              ...diagnosisStepConversation,
              status: "failed",
              error: "channel not found",
              extra: { channel },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          diagnosisStepConversation = {
            ...diagnosisStepConversation,
            status: "success",
            extra: { channel },
          };
          await updateDiagnosisSteps("progress");

          logger?.info("📝 [Slack] test:channel found", { channel });

          // Post a message in the DMs.
          let message: ChatPostMessageResponse;
          try {
            message = await slack.chat.postMessage({
              channel: channel.id,
              text: `<@${auth.user_id}> test:ping`,
            });
          } catch (error) {
            logger?.error("❌ [Slack] test:message not posted", {
              error: format(error),
            });
            diagnosisStepPostMessage = {
              ...diagnosisStepPostMessage,
              status: "failed",
              error: "posting message failed",
              extra: { error: format(error) },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          if (!message?.ts) {
            logger?.error("❌ [Slack] test:message not posted", { message });
            diagnosisStepPostMessage = {
              ...diagnosisStepPostMessage,
              status: "failed",
              error: "posting message missing timestamp",
              extra: { message },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          logger?.info("📝 [Slack] test:ping sent", { message });

          diagnosisStepPostMessage = {
            ...diagnosisStepPostMessage,
            status: "success",
            extra: { message },
          };
          await updateDiagnosisSteps("progress");

          const sleep = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));

          // Wait for the bot to reply.
          let lastReplies: ConversationsRepliesResponse | undefined = undefined;
          for (let i = 0; i < 30; i++) {
            await sleep(1000);
            let replies: ConversationsRepliesResponse;
            try {
              replies = await slack.conversations.replies({
                ts: message.ts,
                channel: channel.id,
              });
            } catch (error) {
              logger?.error("❌ [Slack] test:replies not found", { message });
              diagnosisStepReadReplies = {
                ...diagnosisStepReadReplies,
                status: "failed",
                error: "replies not found",
                extra: { error: format(error) },
              };
              await updateDiagnosisSteps("error");
              return;
            }
            logger?.info("📝 [Slack] test:replies", { replies });
            diagnosisStepReadReplies.extra = { replies };
            lastReplies = replies;
            if (replies?.messages?.some((m) => m.text === "pong")) {
              // Victory!
              logger?.info("📝 [Slack] test:pong successful");
              diagnosisStepReadReplies = {
                ...diagnosisStepReadReplies,
                status: "success",
                extra: { replies },
              };
              await updateDiagnosisSteps("result");
              return;
            }

            await updateDiagnosisSteps("progress");
          }

          logger?.error("❌ [Slack] test:timeout");

          diagnosisStepReadReplies = {
            ...diagnosisStepReadReplies,
            status: "failed",
            error: "replies timed out",
            extra: { lastReplies },
          };
          await updateDiagnosisSteps("error");
        });
      },
    },
  ];
}
