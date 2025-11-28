/**
 * TranscriptIngestionService
 * 
 * Shared service for ingesting transcripts from any source:
 * - Slack modal (text paste or file upload)
 * - External webhook (n8n, Zapier, custom integrations)
 * - Zoom API (cron-based import)
 * - Fireflies import
 * 
 * After ingestion, triggers the metiyWorkflow for analysis.
 * 
 * IMPORTANT: Uses content-based deduplication to prevent duplicate transcripts
 * when Inngest retries failed requests.
 */

import { getPrismaAsync } from "../utils/database";
import { TranscriptOrigin, TranscriptStatus } from "@prisma/client";
import crypto from "crypto";

/**
 * Generate a SHA-256 hash of the content for deduplication
 */
function generateContentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").substring(0, 32);
}

let mastraInstance: any = null;

export function setMastraInstance(instance: any) {
  mastraInstance = instance;
}

async function getMastraLazy() {
  if (!mastraInstance) {
    const { mastra } = await import("../index");
    mastraInstance = mastra;
  }
  return mastraInstance;
}

export interface TranscriptInput {
  title: string;
  content: string;
  origin: TranscriptOrigin;
  slackUserId: string;
  slackChannelId?: string;
  metadata?: {
    fileName?: string;
    fileType?: string;
    linkUrl?: string;
    zoomMeetingId?: string;
    firefliesId?: string;
    durationMinutes?: number;
    participantCount?: number;
    language?: string;
  };
  skipWorkflow?: boolean;
}

export interface IngestionResult {
  success: boolean;
  transcriptId?: string;
  workflowStarted?: boolean;
  error?: string;
}

export async function ingestTranscript(
  input: TranscriptInput,
  logger?: any
): Promise<IngestionResult> {
  const contentHash = generateContentHash(input.content);
  
  logger?.info("📥 [TranscriptIngestion] Starting ingestion", {
    title: input.title,
    origin: input.origin,
    contentLength: input.content?.length || 0,
    slackUserId: input.slackUserId,
    contentHash,
  });

  try {
    const prisma = await getPrismaAsync();

    // Check for existing transcript with the same content hash for this user
    // This prevents duplicate transcripts when Inngest retries failed requests
    const existingTranscript = await prisma.transcript.findFirst({
      where: {
        slack_user_id: input.slackUserId,
        content_hash: contentHash,
        archived: false,
      },
    });

    if (existingTranscript) {
      logger?.info("⏭️ [TranscriptIngestion] Duplicate transcript detected, checking workflow status", {
        existingTranscriptId: existingTranscript.id,
        title: existingTranscript.title,
        status: existingTranscript.status,
        contentHash,
      });

      // Check if the workflow needs to be triggered (status still file_uploaded means it never started)
      let workflowStarted = false;
      if (existingTranscript.status === TranscriptStatus.file_uploaded && !input.skipWorkflow) {
        try {
          logger?.info("🔄 [TranscriptIngestion] Existing transcript needs workflow, triggering", {
            transcriptId: existingTranscript.id,
          });

          const threadId = `transcript/${existingTranscript.id}`;
          const message = `Process transcript "${existingTranscript.title}" (ID: ${existingTranscript.id}):\n\n${input.content}`;
          
          // Trigger workflow via HTTP endpoint (proper Inngest context)
          const workflowResponse = await fetch("http://localhost:5000/api/workflows/metiyWorkflow/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inputData: {
                message,
                threadId,
                slackUserId: input.slackUserId,
                slackChannel: input.slackChannelId || input.slackUserId,
                threadTs: undefined,
                transcriptId: existingTranscript.id,
              },
            }),
          });

          if (!workflowResponse.ok) {
            throw new Error(`Workflow start failed: ${workflowResponse.statusText}`);
          }

          workflowStarted = true;
          logger?.info("✅ [TranscriptIngestion] Workflow triggered for existing transcript via HTTP", {
            transcriptId: existingTranscript.id,
            threadId,
          });
        } catch (workflowError) {
          logger?.error("⚠️ [TranscriptIngestion] Failed to start workflow for existing transcript", {
            error: String(workflowError),
            transcriptId: existingTranscript.id,
          });
        }
      } else {
        logger?.info("⏭️ [TranscriptIngestion] Existing transcript already processing or completed", {
          transcriptId: existingTranscript.id,
          status: existingTranscript.status,
        });
      }

      return {
        success: true,
        transcriptId: existingTranscript.id,
        workflowStarted,
      };
    }

    const transcript = await prisma.transcript.create({
      data: {
        title: input.title,
        origin: input.origin,
        status: TranscriptStatus.file_uploaded,
        slack_user_id: input.slackUserId,
        slack_channel_id: input.slackChannelId || "app_home",
        raw_content: input.content,
        transcript_text: input.content,
        content_hash: contentHash,
        language: input.metadata?.language || "en",
        file_name: input.metadata?.fileName,
        file_type: input.metadata?.fileType,
        link_url: input.metadata?.linkUrl,
        zoom_meeting_id: input.metadata?.zoomMeetingId,
        fireflies_id: input.metadata?.firefliesId,
        duration_minutes: input.metadata?.durationMinutes,
        participant_count: input.metadata?.participantCount,
      },
    });

    logger?.info("✅ [TranscriptIngestion] Transcript saved", {
      transcriptId: transcript.id,
      title: transcript.title,
      origin: transcript.origin,
      contentHash,
    });

    await prisma.transcriptActivity.create({
      data: {
        transcript_id: transcript.id,
        activity_type: "ingestion_completed",
        message: `Transcript ingested from ${input.origin}`,
        metadata: {
          contentLength: input.content?.length || 0,
          fileName: input.metadata?.fileName,
        },
      },
    });

    logger?.info("📝 [TranscriptIngestion] Activity logged", {
      transcriptId: transcript.id,
    });

    let workflowStarted = false;

    if (!input.skipWorkflow) {
      try {
        logger?.info("🚀 [TranscriptIngestion] Triggering metiyWorkflow", {
          transcriptId: transcript.id,
        });

        const threadId = `transcript/${transcript.id}`;
        const message = `Process transcript "${transcript.title}" (ID: ${transcript.id}):\n\n${input.content}`;
        
        // Trigger workflow via HTTP endpoint (proper Inngest context)
        const workflowResponse = await fetch("http://localhost:5000/api/workflows/metiyWorkflow/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputData: {
              message,
              threadId,
              slackUserId: input.slackUserId,
              slackChannel: input.slackChannelId || input.slackUserId,
              threadTs: undefined,
              transcriptId: transcript.id,
            },
          }),
        });

        if (!workflowResponse.ok) {
          throw new Error(`Workflow start failed: ${workflowResponse.statusText}`);
        }

        workflowStarted = true;
        logger?.info("✅ [TranscriptIngestion] Workflow started via HTTP", {
          transcriptId: transcript.id,
          threadId,
        });

        await prisma.transcriptActivity.create({
          data: {
            transcript_id: transcript.id,
            activity_type: "workflow_started",
            message: "Analysis workflow started",
          },
        });
      } catch (workflowError) {
        logger?.error("⚠️ [TranscriptIngestion] Failed to start workflow", {
          error: String(workflowError),
          transcriptId: transcript.id,
        });
      }
    }

    return {
      success: true,
      transcriptId: transcript.id,
      workflowStarted,
    };
  } catch (error) {
    logger?.error("❌ [TranscriptIngestion] Failed to ingest transcript", {
      error: String(error),
      title: input.title,
      origin: input.origin,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getTranscriptById(transcriptId: string, logger?: any) {
  logger?.info("🔍 [TranscriptIngestion] Fetching transcript", { transcriptId });

  try {
    const prisma = await getPrismaAsync();
    const transcript = await prisma.transcript.findUnique({
      where: { id: transcriptId },
      include: {
        insights: true,
        activities: {
          orderBy: { created_at: "desc" },
          take: 10,
        },
      },
    });

    if (!transcript) {
      logger?.warn("⚠️ [TranscriptIngestion] Transcript not found", { transcriptId });
      return null;
    }

    logger?.info("✅ [TranscriptIngestion] Transcript fetched", {
      transcriptId,
      insightCount: transcript.insights.length,
    });

    return transcript;
  } catch (error) {
    logger?.error("❌ [TranscriptIngestion] Failed to fetch transcript", {
      error: String(error),
      transcriptId,
    });
    return null;
  }
}

export async function updateTranscriptStatus(
  transcriptId: string,
  status: TranscriptStatus,
  logger?: any
) {
  logger?.info("🔄 [TranscriptIngestion] Updating status", { transcriptId, status });

  try {
    const prisma = await getPrismaAsync();
    
    const transcript = await prisma.transcript.update({
      where: { id: transcriptId },
      data: {
        status,
        processed_at: status === TranscriptStatus.completed ? new Date() : undefined,
      },
    });

    await prisma.transcriptActivity.create({
      data: {
        transcript_id: transcriptId,
        activity_type: `status_changed_to_${status}`,
        message: `Status updated to ${status}`,
      },
    });

    logger?.info("✅ [TranscriptIngestion] Status updated", {
      transcriptId,
      status,
    });

    return transcript;
  } catch (error) {
    logger?.error("❌ [TranscriptIngestion] Failed to update status", {
      error: String(error),
      transcriptId,
      status,
    });
    throw error;
  }
}

export async function listTranscriptsForUser(
  slackUserId: string,
  options?: {
    limit?: number;
    offset?: number;
    origin?: TranscriptOrigin;
  },
  logger?: any
) {
  logger?.info("📋 [TranscriptIngestion] Listing transcripts", {
    slackUserId,
    options,
  });

  try {
    const prisma = await getPrismaAsync();
    
    const transcripts = await prisma.transcript.findMany({
      where: {
        slack_user_id: slackUserId,
        ...(options?.origin ? { origin: options.origin } : {}),
      },
      orderBy: { created_at: "desc" },
      take: options?.limit || 20,
      skip: options?.offset || 0,
      include: {
        _count: {
          select: { insights: true },
        },
      },
    });

    logger?.info("✅ [TranscriptIngestion] Transcripts listed", {
      slackUserId,
      count: transcripts.length,
    });

    return transcripts;
  } catch (error) {
    logger?.error("❌ [TranscriptIngestion] Failed to list transcripts", {
      error: String(error),
      slackUserId,
    });
    return [];
  }
}
