/**
 * Transcript Webhook API
 * 
 * Public endpoint for external sources to submit transcripts:
 * - n8n workflows
 * - Zapier integrations
 * - Custom API integrations
 * 
 * Endpoint: POST /api/webhooks/transcript
 */

import { z } from "zod";
import type { Context } from "hono";
import { ingestTranscript } from "../services/transcriptIngestion";
import { TranscriptOrigin } from "@prisma/client";

const WebhookPayloadSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(10, "Content must be at least 10 characters"),
  source: z.string().optional().default("custom_api"),
  userId: z.string().min(1, "User ID is required"),
  channelId: z.string().optional(),
  metadata: z.object({
    fileName: z.string().optional(),
    fileType: z.string().optional(),
    linkUrl: z.string().optional(),
    zoomMeetingId: z.string().optional(),
    firefliesId: z.string().optional(),
    durationMinutes: z.number().optional(),
    participantCount: z.number().optional(),
    language: z.string().optional(),
  }).optional(),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

export async function handleTranscriptWebhook(c: Context, logger?: any) {
  logger?.info("📥 [Webhook] Incoming transcript webhook request");

  try {
    const authHeader = c.req.header("X-MeetyAI-Secret");
    const expectedSecret = process.env.MEETYAI_WEBHOOK_SECRET;
    
    if (expectedSecret && authHeader !== expectedSecret) {
      logger?.warn("🚫 [Webhook] Unauthorized request - invalid secret");
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json();
    logger?.info("📝 [Webhook] Payload received", { 
      title: body.title,
      contentLength: body.content?.length,
      source: body.source,
    });

    const parsed = WebhookPayloadSchema.safeParse(body);
    
    if (!parsed.success) {
      logger?.warn("⚠️ [Webhook] Invalid payload", { errors: parsed.error.errors });
      return c.json({ 
        error: "Invalid payload", 
        details: parsed.error.errors 
      }, 400);
    }

    const payload = parsed.data;

    let origin: TranscriptOrigin = TranscriptOrigin.custom_api;
    if (payload.source === "zoom") {
      origin = TranscriptOrigin.zoom_import;
    } else if (payload.source === "fireflies") {
      origin = TranscriptOrigin.fireflies_import;
    } else if (payload.source === "link") {
      origin = TranscriptOrigin.link;
    }

    const result = await ingestTranscript({
      title: payload.title,
      content: payload.content,
      origin,
      slackUserId: payload.userId,
      slackChannelId: payload.channelId,
      metadata: payload.metadata,
    }, logger);

    if (!result.success) {
      logger?.error("❌ [Webhook] Ingestion failed", { error: result.error });
      return c.json({ 
        error: "Failed to ingest transcript",
        details: result.error 
      }, 500);
    }

    logger?.info("✅ [Webhook] Transcript ingested successfully", {
      transcriptId: result.transcriptId,
      title: payload.title,
    });

    return c.json({
      success: true,
      transcriptId: result.transcriptId,
      message: "Transcript received and queued for processing",
    }, 202);

  } catch (error) {
    logger?.error("❌ [Webhook] Unexpected error", { error: String(error) });
    return c.json({ 
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}

export const webhookApiDocs = `
# MeetyAI Transcript Webhook API

## Endpoint
POST /api/webhooks/transcript

## Authentication
Include the secret in the X-MeetyAI-Secret header:
\`\`\`
X-MeetyAI-Secret: your-webhook-secret
\`\`\`

## Request Body
\`\`\`json
{
  "title": "Sales Call with ACME Corp",
  "content": "Full transcript text here...",
  "source": "custom_api",
  "userId": "U1234567890",
  "channelId": "C1234567890",
  "metadata": {
    "fileName": "transcript.txt",
    "fileType": "txt",
    "durationMinutes": 45,
    "participantCount": 3,
    "language": "en"
  }
}
\`\`\`

## Response
Success (202):
\`\`\`json
{
  "success": true,
  "transcriptId": "uuid-here",
  "message": "Transcript received and queued for processing"
}
\`\`\`

Error (400):
\`\`\`json
{
  "error": "Invalid payload",
  "details": [...]
}
\`\`\`

## n8n Integration Example
1. Use HTTP Request node
2. Method: POST
3. URL: https://your-app.replit.app/api/webhooks/transcript
4. Headers: X-MeetyAI-Secret: your-secret
5. Body: JSON with title, content, userId

## cURL Example
\`\`\`bash
curl -X POST https://your-app.replit.app/api/webhooks/transcript \\
  -H "Content-Type: application/json" \\
  -H "X-MeetyAI-Secret: your-secret" \\
  -d '{
    "title": "Test Transcript",
    "content": "This is the transcript content...",
    "userId": "U1234567890"
  }'
\`\`\`
`;
