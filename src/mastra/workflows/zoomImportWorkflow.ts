/**
 * Zoom Import Workflow
 * 
 * Hourly cron job that:
 * 1. Fetches new cloud recordings from Zoom API
 * 2. Downloads transcript files (VTT format)
 * 3. Saves them to database
 * 4. Updates import status
 */

import { z } from "zod";
import { createWorkflow, createStep } from "../inngest";
import { ingestTranscript } from "../services/transcriptIngestion";
import { TranscriptOrigin } from "@prisma/client";
import { getPrismaAsync } from "../utils/database";

const ZoomInputSchema = z.object({
  userId: z.string().optional(),
});

const RecordingSchema = z.object({
  meetingId: z.string(),
  topic: z.string(),
  startTime: z.string(),
  duration: z.number(),
  transcriptUrl: z.string().optional(),
  hasTranscript: z.boolean(),
});

const RecordingsOutputSchema = z.object({
  recordings: z.array(RecordingSchema),
  accessToken: z.string().optional(),
  error: z.string().optional(),
});

const ImportResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  failed: z.number(),
  transcriptIds: z.array(z.string()),
});

async function getZoomAccessToken(logger?: any): Promise<{ token: string | null; error: string | null }> {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    logger?.warn("⚠️ [ZoomImport] Zoom credentials not configured");
    return { token: null, error: "Zoom API credentials not configured" };
  }

  try {
    const tokenResponse = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (!tokenResponse.ok) {
      logger?.error("❌ [ZoomImport] Failed to get Zoom access token", {
        status: tokenResponse.status,
      });
      return { token: null, error: "Failed to authenticate with Zoom API" };
    }

    const tokenData = await tokenResponse.json();
    return { token: tokenData.access_token, error: null };
  } catch (error) {
    logger?.error("❌ [ZoomImport] Error getting access token", {
      error: String(error),
    });
    return { token: null, error: String(error) };
  }
}

const fetchZoomRecordingsStep = createStep({
  id: "fetch-zoom-recordings",
  inputSchema: ZoomInputSchema,
  outputSchema: RecordingsOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔍 [ZoomImport] Fetching Zoom recordings");

    const { token: accessToken, error: tokenError } = await getZoomAccessToken(logger);
    
    if (!accessToken) {
      return {
        recordings: [],
        error: tokenError || "Failed to get access token",
      };
    }

    try {
      const fromDate = new Date();
      fromDate.setHours(fromDate.getHours() - 2);
      const from = fromDate.toISOString().split("T")[0];
      const to = new Date().toISOString().split("T")[0];

      const recordingsResponse = await fetch(
        `https://api.zoom.us/v2/users/me/recordings?from=${from}&to=${to}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!recordingsResponse.ok) {
        logger?.error("❌ [ZoomImport] Failed to fetch recordings", {
          status: recordingsResponse.status,
        });
        return {
          recordings: [],
          error: "Failed to fetch recordings from Zoom",
        };
      }

      const recordingsData = await recordingsResponse.json();
      const meetings = recordingsData.meetings || [];

      logger?.info("📋 [ZoomImport] Found meetings", {
        count: meetings.length,
      });

      const recordings = meetings.map((meeting: any) => {
        const transcriptFile = meeting.recording_files?.find(
          (f: any) => f.file_type === "TRANSCRIPT" || f.recording_type === "audio_transcript"
        );

        return {
          meetingId: String(meeting.id),
          topic: meeting.topic || "Untitled Meeting",
          startTime: meeting.start_time || new Date().toISOString(),
          duration: meeting.duration || 0,
          transcriptUrl: transcriptFile?.download_url,
          hasTranscript: !!transcriptFile,
        };
      });

      const withTranscripts = recordings.filter((r: any) => r.hasTranscript);
      logger?.info("✅ [ZoomImport] Recordings with transcripts", {
        total: recordings.length,
        withTranscripts: withTranscripts.length,
      });

      return { 
        recordings: withTranscripts,
        accessToken,
      };
    } catch (error) {
      logger?.error("❌ [ZoomImport] Error fetching recordings", {
        error: String(error),
      });
      return {
        recordings: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

const downloadAndSaveTranscriptsStep = createStep({
  id: "download-save-transcripts",
  inputSchema: RecordingsOutputSchema,
  outputSchema: ImportResultSchema,
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { recordings, accessToken, error } = inputData;

    if (error) {
      logger?.warn("⚠️ [ZoomImport] Skipping due to previous error", { error });
      return { imported: 0, skipped: 0, failed: 0, transcriptIds: [] };
    }

    if (!recordings || recordings.length === 0) {
      logger?.info("ℹ️ [ZoomImport] No new recordings to import");
      return { imported: 0, skipped: 0, failed: 0, transcriptIds: [] };
    }

    if (!accessToken) {
      const { token } = await getZoomAccessToken(logger);
      if (!token) {
        logger?.error("❌ [ZoomImport] No access token available");
        return { imported: 0, skipped: 0, failed: 0, transcriptIds: [] };
      }
    }

    const prisma = await getPrismaAsync();

    const importSources = await prisma.importSource.findMany({
      where: {
        provider: "zoom",
        enabled: true,
      },
    });

    const defaultUserId = importSources[0]?.user_id || "system";

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const transcriptIds: string[] = [];

    for (const recording of recordings) {
      logger?.info("📥 [ZoomImport] Processing recording", {
        meetingId: recording.meetingId,
        topic: recording.topic,
      });

      const existingTranscript = await prisma.transcript.findFirst({
        where: {
          zoom_meeting_id: recording.meetingId,
        },
      });

      if (existingTranscript) {
        logger?.info("⏭️ [ZoomImport] Skipping existing transcript", {
          meetingId: recording.meetingId,
        });
        skipped++;
        continue;
      }

      if (!recording.transcriptUrl) {
        logger?.warn("⚠️ [ZoomImport] No transcript URL", {
          meetingId: recording.meetingId,
        });
        skipped++;
        continue;
      }

      try {
        const transcriptResponse = await fetch(
          `${recording.transcriptUrl}?access_token=${accessToken}`
        );

        if (!transcriptResponse.ok) {
          logger?.error("❌ [ZoomImport] Failed to download transcript", {
            meetingId: recording.meetingId,
            status: transcriptResponse.status,
          });
          failed++;
          continue;
        }

        const transcriptContent = await transcriptResponse.text();
        logger?.info("✅ [ZoomImport] Downloaded transcript", {
          meetingId: recording.meetingId,
          contentLength: transcriptContent.length,
        });

        const result = await ingestTranscript({
          title: recording.topic,
          content: transcriptContent,
          origin: TranscriptOrigin.zoom_import,
          slackUserId: defaultUserId,
          metadata: {
            zoomMeetingId: recording.meetingId,
            durationMinutes: recording.duration,
            fileType: "vtt",
          },
        }, logger);

        if (result.success && result.transcriptId) {
          transcriptIds.push(result.transcriptId);
          imported++;
          logger?.info("✅ [ZoomImport] Transcript ingested", {
            transcriptId: result.transcriptId,
            topic: recording.topic,
          });
        } else {
          failed++;
          logger?.error("❌ [ZoomImport] Failed to ingest transcript", {
            error: result.error,
          });
        }
      } catch (error) {
        logger?.error("❌ [ZoomImport] Error processing recording", {
          meetingId: recording.meetingId,
          error: String(error),
        });
        failed++;
      }
    }

    await prisma.importSource.updateMany({
      where: {
        provider: "zoom",
        enabled: true,
      },
      data: {
        last_run_at: new Date(),
        last_run_status: `Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}`,
      },
    });

    logger?.info("🎉 [ZoomImport] Import complete", {
      imported,
      skipped,
      failed,
    });

    return { imported, skipped, failed, transcriptIds };
  },
});

export const zoomImportWorkflow = createWorkflow({
  id: "zoom-import-workflow",
  inputSchema: ZoomInputSchema,
  outputSchema: ImportResultSchema,
})
  .then(fetchZoomRecordingsStep)
  .then(downloadAndSaveTranscriptsStep)
  .commit();
