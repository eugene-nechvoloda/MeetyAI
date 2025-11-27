/**
 * Save Insights Tool
 * 
 * Stores extracted insights to database with evidence, confidence, and duplicate flags
 * Includes deduplication logic using content hash to prevent duplicate insights
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";
import { getPrisma } from "../utils/database";
import { InsightType, InsightStatus } from "../utils/prismaTypes";
import * as crypto from "crypto";

const evidenceQuoteSchema = z.object({
  quote: z.string(),
  timestamp: z.string().optional(),
  speaker: z.string().optional(),
});

const insightInputSchema = z.object({
  title: z.string(),
  description: z.string(),
  type: z.string(),
  author: z.string().optional(),
  evidence_text: z.string().optional(),
  evidence: z.array(evidenceQuoteSchema),
  confidence: z.number(),
  timestamp_start: z.string().optional(),
  timestamp_end: z.string().optional(),
  speaker: z.string().optional(),
  is_duplicate: z.boolean().optional(),
  duplicate_of_id: z.number().optional(),
  duplicate_similarity: z.number().optional(),
});

/**
 * Generate a content hash for deduplication
 * Uses normalized description + evidence_text to detect duplicates
 */
function generateContentHash(description: string, evidenceText?: string): string {
  const normalizedContent = `${description.toLowerCase().trim()}|${(evidenceText || "").toLowerCase().trim()}`;
  return crypto.createHash("sha256").update(normalizedContent).digest("hex").substring(0, 32);
}

export const saveInsightsTool = createTool({
  id: "save-insights-to-database",
  description: "Saves extracted insights to the database with all metadata, evidence, and duplicate flags. Use this after analysis to persist the results.",
  
  inputSchema: z.object({
    transcriptId: z.string().describe("Database ID of the transcript these insights belong to"),
    insights: z.array(insightInputSchema).describe("Array of insights to save"),
  }),
  
  outputSchema: z.object({
    savedCount: z.number().describe("Number of insights successfully saved"),
    failedCount: z.number().describe("Number of insights that failed to save"),
    insightIds: z.array(z.string()).describe("Database IDs of saved insights"),
    success: z.boolean().describe("Whether operation was successful"),
    error: z.string().optional().describe("Error message if failed"),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = createLogger(mastra, "SaveInsightsTool");
    const { transcriptId, insights } = context;
    
    logger.toolStart("save-insights-to-database", {
      transcriptId,
      insightCount: insights.length,
    });
    
    try {
      const prisma = getPrisma();
      const savedIds: string[] = [];
      let failedCount = 0;
      
      // Verify transcript exists
      const transcript = await prisma.transcript.findUnique({
        where: { id: transcriptId },
      });
      
      if (!transcript) {
        throw new Error(`Transcript ${transcriptId} not found`);
      }
      
      // Get existing content hashes for this transcript (for deduplication)
      const existingInsights = await prisma.insight.findMany({
        where: { transcript_id: transcriptId },
        select: { content_hash: true, id: true },
      });
      const existingHashes = new Set(
        existingInsights.map((i: { content_hash: string | null }) => i.content_hash).filter(Boolean) as string[]
      );
      
      logger.info("📊 Deduplication check", {
        existingInsightCount: existingInsights.length,
        existingHashes: existingHashes.size,
      });
      
      let skippedDuplicates = 0;
      
      // Save each insight
      for (const insight of insights) {
        try {
          // Generate content hash for deduplication
          const contentHash = generateContentHash(insight.description, insight.evidence_text);
          
          // Check for duplicates using content hash
          if (existingHashes.has(contentHash)) {
            logger.info("⏭️ Skipping duplicate insight", {
              title: insight.title,
              contentHash,
            });
            skippedDuplicates++;
            continue;
          }
          
          // Map string type to enum
          const mappedType = mapInsightType(insight.type);
          
          const saved = await prisma.insight.create({
            data: {
              transcript_id: transcriptId,
              title: insight.title,
              description: insight.description,
              type: mappedType,
              author: insight.author || insight.speaker,
              evidence_text: insight.evidence_text || (insight.evidence?.[0]?.quote || null),
              evidence_quotes: insight.evidence as any,
              confidence: insight.confidence,
              content_hash: contentHash,
              is_duplicate: insight.is_duplicate || false,
              duplicate_similarity: insight.duplicate_similarity,
              timestamp_start: insight.timestamp_start,
              timestamp_end: insight.timestamp_end,
              speaker: insight.speaker,
              status: InsightStatus.new,
              approved: false,
              exported: false,
            },
          });
          
          savedIds.push(saved.id);
          
          // Add the new hash to the set to prevent duplicates within the same batch
          existingHashes.add(contentHash);
          
        } catch (saveError) {
          logger.error("Failed to save insight", {
            insight: insight.title,
            error: saveError instanceof Error ? saveError.message : "Unknown",
          });
          failedCount++;
        }
      }
      
      logger.info("📈 Save insights summary", {
        saved: savedIds.length,
        skippedDuplicates,
        failed: failedCount,
      });
      
      // Send notification to user
      try {
        const { getClient } = await import("../../triggers/slackTriggers");
        const { slack } = await getClient();
        
        // Open DM channel with user
        const dmChannel = await slack.conversations.open({
          users: transcript.slack_user_id,
        });
        
        if (!dmChannel.channel?.id) {
          throw new Error("Failed to open DM channel");
        }
        
        const notificationText = savedIds.length > 0
          ? `✅ *Analysis Complete!*\n\nExtracted ${savedIds.length} insights from your transcript "${transcript.title}".\n\n💡 View them in the Insights tab of the MeetyAI app!`
          : `⚠️ Analysis complete, but no insights were extracted from "${transcript.title}". Try uploading a different transcript.`;
        
        await slack.chat.postMessage({
          channel: dmChannel.channel.id,
          text: notificationText,
        });
        
        logger.info("📬 Notification sent to user", {
          userId: transcript.slack_user_id,
          dmChannelId: dmChannel.channel.id,
          insightCount: savedIds.length,
        });
      } catch (notificationError) {
        // Don't fail the tool if notification fails
        logger.error("Failed to send notification", {
          error: notificationError instanceof Error ? notificationError.message : "Unknown",
        });
      }
      
      logger.toolComplete("save-insights-to-database", {
        savedCount: savedIds.length,
        failedCount,
      });
      
      return {
        savedCount: savedIds.length,
        failedCount,
        insightIds: savedIds,
        success: true,
      };
    } catch (error) {
      logger.toolError("save-insights-to-database", error as Error);
      
      return {
        savedCount: 0,
        failedCount: insights.length,
        insightIds: [],
        success: false,
        error: `Failed to save insights: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});

/**
 * Maps string insight type to Prisma enum
 */
function mapInsightType(type: string): InsightType {
  const typeMap: Record<string, InsightType> = {
    "pain": InsightType.pain,
    "blocker": InsightType.blocker,
    "feature_request": InsightType.feature_request,
    "idea": InsightType.idea,
    "gain": InsightType.gain,
    "outcome": InsightType.outcome,
    "objection": InsightType.objection,
    "buying_signal": InsightType.buying_signal,
    "question": InsightType.question,
    "feedback": InsightType.feedback,
    "confusion": InsightType.confusion,
    "opportunity": InsightType.opportunity,
    "insight": InsightType.insight,
  };
  
  return typeMap[type.toLowerCase()] || InsightType.other;
}
