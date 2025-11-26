/**
 * TranscriptIngestionService
 * 
 * Shared service for ingesting transcripts from any source:
 * - Slack modal (text paste or file upload)
 * - External webhook (n8n, Zapier, custom integrations)
 * - Zoom API (cron-based import)
 * - Fireflies import
 */

import { getPrismaAsync } from "../utils/database";
import { TranscriptOrigin, TranscriptStatus } from "@prisma/client";

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
}

export interface IngestionResult {
  success: boolean;
  transcriptId?: string;
  error?: string;
}

export async function ingestTranscript(
  input: TranscriptInput,
  logger?: any
): Promise<IngestionResult> {
  logger?.info("📥 [TranscriptIngestion] Starting ingestion", {
    title: input.title,
    origin: input.origin,
    contentLength: input.content?.length || 0,
    slackUserId: input.slackUserId,
  });

  try {
    const prisma = await getPrismaAsync();

    const transcript = await prisma.transcript.create({
      data: {
        title: input.title,
        origin: input.origin,
        status: TranscriptStatus.file_uploaded,
        slack_user_id: input.slackUserId,
        slack_channel_id: input.slackChannelId || "app_home",
        raw_content: input.content,
        transcript_text: input.content,
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

    return {
      success: true,
      transcriptId: transcript.id,
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
