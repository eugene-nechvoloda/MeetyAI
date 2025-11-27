/**
 * Export to Airtable Tool
 * 
 * Exports insights to Airtable as records with field mapping and filtering
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import Airtable from "airtable";
import { createLogger } from "../utils/logger";
import { getPrisma } from "../utils/database";

export const exportAirtableTool = createTool({
  id: "export-to-airtable",
  description: "Exports approved insights to Airtable as records. Maps MeetyAI insight fields to Airtable table fields based on configuration.",
  
  inputSchema: z.object({
    insightIds: z.array(z.string()).describe("Array of insight IDs to export"),
    userId: z.string().describe("Slack user ID for finding export config"),
  }),
  
  outputSchema: z.object({
    exportedCount: z.number(),
    failedCount: z.number(),
    airtableRecordIds: z.array(z.string()),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = createLogger(mastra, "ExportAirtableTool");
    const { insightIds, userId } = context;
    
    logger.toolStart("export-to-airtable", { insightIds, userId });
    
    try {
      const prisma = getPrisma();
      
      // Get Airtable export config
      const config = await prisma.exportConfig.findFirst({
        where: {
          user_id: userId,
          provider: "airtable",
          enabled: true,
        },
      });
      
      if (!config) {
        throw new Error("Airtable not configured. Please set up Airtable in Settings > Export.");
      }
      
      // Decrypt credentials
      const { decrypt } = await import("../utils/encryption");
      const credentials = JSON.parse(decrypt(config.credentials_encrypted));
      
      // Initialize Airtable
      Airtable.configure({
        apiKey: credentials.api_key,
      });
      
      const base = Airtable.base(credentials.base_id || config.team_id || "");
      const table = base(credentials.table_name || "Insights");
      
      const airtableRecordIds: string[] = [];
      let failedCount = 0;
      
      // Get field mapping from config (default to 'title'/'description' if not set)
      const fieldMapping = (config.field_mapping as any) || { title: "Title", description: "Description" };
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
          
          // Check for duplicates (skip if already exported to Airtable)
          const exportDest = insight.export_destinations as any;
          if (exportDest?.provider === "airtable" && exportDest?.id) {
            logger.info("Skipping insight - already exported to Airtable", {
              insightId: insight.id,
              airtableRecordId: exportDest.id,
            });
            continue;
          }
          
          // Build record data using field mapping
          const recordData: any = {};
          
          // Map title field
          recordData[fieldMapping.title || "Title"] = insight.title;
          
          // Map description field
          recordData[fieldMapping.description || "Description"] = insight.description;
          
          // Add author if available
          if (insight.author || insight.speaker) {
            recordData[fieldMapping.author || "Author"] = insight.author || insight.speaker;
          }
          
          // Add evidence text (the primary quote)
          if (insight.evidence_text) {
            recordData[fieldMapping.evidence || "Evidence"] = insight.evidence_text;
          } else if (insight.evidence_quotes && Array.isArray(insight.evidence_quotes)) {
            const firstQuote = (insight.evidence_quotes as any[])[0];
            if (firstQuote?.quote) {
              recordData[fieldMapping.evidence || "Evidence"] = firstQuote.quote;
            }
          }
          
          // Add additional standard fields if they exist
          if (fieldMapping.type) recordData[fieldMapping.type] = insight.type;
          if (fieldMapping.confidence) recordData[fieldMapping.confidence] = insight.confidence;
          if (fieldMapping.source) recordData[fieldMapping.source] = insight.transcript.title;
          if (fieldMapping.status) recordData[fieldMapping.status] = "New";
          
          logger.info("Creating Airtable record with mapped fields", {
            insightId: insight.id,
            recordData,
          });
          
          // Create Airtable record
          const records = await table.create([
            {
              fields: recordData,
            },
          ]);
          
          const recordId = records[0].id;
          airtableRecordIds.push(recordId);
          
          // Update insight as exported with status
          await prisma.insight.update({
            where: { id: insight.id },
            data: {
              exported: true,
              status: "exported",
              export_destinations: {
                provider: "airtable",
                id: recordId,
                exported_at: new Date().toISOString(),
                status: "success",
              } as any,
            },
          });
          
          logger.info("✅ Successfully exported insight", {
            insightId: insight.id,
            recordId,
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
                  provider: "airtable",
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
      
      logger.toolComplete("export-to-airtable", {
        exportedCount: airtableRecordIds.length,
        failedCount,
      });
      
      return {
        exportedCount: airtableRecordIds.length,
        failedCount,
        airtableRecordIds,
        success: true,
      };
    } catch (error) {
      logger.toolError("export-to-airtable", error as Error);
      
      return {
        exportedCount: 0,
        failedCount: insightIds.length,
        airtableRecordIds: [],
        success: false,
        error: `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
