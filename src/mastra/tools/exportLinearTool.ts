/**
 * Export to Linear Tool
 * 
 * Exports insights to Linear as issues
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { LinearClient } from "@linear/sdk";
import { createLogger } from "../utils/logger";
import { getPrisma } from "../utils/database";

export const exportLinearTool = createTool({
  id: "export-to-linear",
  description: "Exports approved insights to Linear as issues. Maps MeetyAI insight fields to Linear issue fields based on configuration.",
  
  inputSchema: z.object({
    insightIds: z.array(z.string()).describe("Array of insight IDs to export"),
    userId: z.string().describe("Slack user ID for finding export config"),
  }),
  
  outputSchema: z.object({
    exportedCount: z.number(),
    failedCount: z.number(),
    linearIssueIds: z.array(z.string()),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = createLogger(mastra, "ExportLinearTool");
    const { insightIds, userId } = context;
    
    logger.toolStart("export-to-linear", { insightIds, userId });
    
    try {
      const prisma = getPrisma();
      
      // Get Linear export config
      const config = await prisma.exportConfig.findFirst({
        where: {
          user_id: userId,
          provider: "linear",
          enabled: true,
        },
      });
      
      if (!config) {
        throw new Error("Linear not configured. Please set up Linear in Settings > Export.");
      }
      
      // Decrypt credentials
      const { decrypt } = await import("../utils/encryption");
      const credentials = JSON.parse(decrypt(config.credentials_encrypted));
      
      // Initialize Linear client
      const linear = new LinearClient({ apiKey: credentials.api_key });
      
      const linearIssueIds: string[] = [];
      let failedCount = 0;
      
      // Get field mapping from config (default to 'title'/'description' if not set)
      const fieldMapping = (config.field_mapping as any) || { title: "title", description: "description" };
      const minConfidence = config.min_confidence ?? 0.7;
      const typesFilter = (config.types_filter as string[]) || [];
      
      logger.info("Applying export configuration", {
        fieldMapping,
        minConfidence,
        typesFilter,
      });
      
      // Get insights
      const insights = await prisma.insight.findMany({
        where: {
          id: { in: insightIds },
        },
        include: {
          transcript: true,
        },
      });
      
      for (const insight of insights) {
        try {
          // Apply confidence filter
          if (insight.confidence < minConfidence) {
            logger.info("Skipping insight - below confidence threshold", {
              insightId: insight.id,
              confidence: insight.confidence,
              minConfidence,
            });
            continue;
          }
          
          // Apply type filter (if configured)
          if (typesFilter.length > 0 && !typesFilter.includes(insight.type)) {
            logger.info("Skipping insight - type not in filter", {
              insightId: insight.id,
              type: insight.type,
              allowedTypes: typesFilter,
            });
            continue;
          }
          
          // Check for duplicates (skip if already exported to Linear)
          const exportDest = insight.export_destinations as any;
          if (exportDest?.provider === "linear" && exportDest?.id) {
            logger.info("Skipping insight - already exported to Linear", {
              insightId: insight.id,
              linearIssueId: exportDest.id,
            });
            continue;
          }
          
          // Build issue data using field mapping
          const issueData: any = {
            teamId: config.team_id || "",
          };
          
          // Map title field
          issueData[fieldMapping.title || "title"] = insight.title;
          
          // Build description with author and evidence
          let descriptionContent = insight.description;
          
          // Add author if available
          if (insight.author || insight.speaker) {
            descriptionContent += `\n\n**Author:** ${insight.author || insight.speaker}`;
          }
          
          // Add evidence text
          if (insight.evidence_text) {
            descriptionContent += `\n\n**Evidence:**\n> ${insight.evidence_text}`;
          } else if (insight.evidence_quotes && Array.isArray(insight.evidence_quotes)) {
            const firstQuote = (insight.evidence_quotes as any[])[0];
            if (firstQuote?.quote) {
              descriptionContent += `\n\n**Evidence:**\n> ${firstQuote.quote}`;
            }
          }
          
          descriptionContent += `\n\n**Confidence:** ${(insight.confidence * 100).toFixed(0)}%\n**Source:** ${insight.transcript.title}`;
          issueData[fieldMapping.description || "description"] = descriptionContent;
          
          // Set priority based on confidence
          issueData.priority = insight.confidence > 0.8 ? 1 : 2;
          
          logger.info("Creating Linear issue with mapped fields", {
            insightId: insight.id,
            issueData,
          });
          
          // Create Linear issue
          const issuePayload = await linear.createIssue(issueData);
          const createdIssue = await issuePayload.issue;
          const issueId = createdIssue?.id || "";
          
          linearIssueIds.push(issueId);
          
          // Update insight as exported with status
          await prisma.insight.update({
            where: { id: insight.id },
            data: {
              exported: true,
              status: "exported",
              export_destinations: {
                provider: "linear",
                id: issueId,
                exported_at: new Date().toISOString(),
                status: "success",
              } as any,
            },
          });
          
          logger.info("✅ Successfully exported insight to Linear", {
            insightId: insight.id,
            issueId,
          });
        } catch (exportError) {
          logger.error("Failed to export insight", {
            insightId: insight.id,
            error: exportError instanceof Error ? exportError.message : "Unknown",
          });
          
          // Mark as export_failed
          try {
            await prisma.insight.update({
              where: { id: insight.id },
              data: {
                status: "export_failed",
                export_destinations: {
                  provider: "linear",
                  error: exportError instanceof Error ? exportError.message : "Unknown error",
                  attempted_at: new Date().toISOString(),
                  status: "failed",
                } as any,
              },
            });
          } catch (updateError) {
            logger.error("Failed to update insight status", {
              insightId: insight.id,
              error: updateError instanceof Error ? updateError.message : "Unknown",
            });
          }
          
          failedCount++;
        }
      }
      
      logger.toolComplete("export-to-linear", {
        exportedCount: linearIssueIds.length,
        failedCount,
      });
      
      return {
        exportedCount: linearIssueIds.length,
        failedCount,
        linearIssueIds,
        success: true,
      };
    } catch (error) {
      logger.toolError("export-to-linear", error as Error);
      
      return {
        exportedCount: 0,
        failedCount: insightIds.length,
        linearIssueIds: [],
        success: false,
        error: `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
