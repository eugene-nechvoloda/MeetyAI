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
  description: "Exports approved insights to Linear as issues. Maps METIY insight fields to Linear issue fields based on configuration.",
  
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
          // Create Linear issue
          const issue = await linear.createIssue({
            teamId: config.team_id || "",
            title: insight.title,
            description: `${insight.description}\n\n**Evidence:**\n${JSON.stringify(insight.evidence_quotes, null, 2)}\n\n**Confidence:** ${insight.confidence}\n**Source:** ${insight.transcript.title}`,
            priority: insight.confidence > 0.8 ? 1 : 2,
          });
          
          linearIssueIds.push(issue.issue?.id || "");
          
          // Update insight as exported
          await prisma.insight.update({
            where: { id: insight.id },
            data: {
              exported: true,
              export_destinations: {
                provider: "linear",
                id: issue.issue?.id,
                exported_at: new Date().toISOString(),
              } as any,
            },
          });
        } catch (exportError) {
          logger.error("Failed to export insight", {
            insightId: insight.id,
            error: exportError instanceof Error ? exportError.message : "Unknown",
          });
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
