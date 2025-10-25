/**
 * Extract Transcript Tool
 * 
 * Handles TXT and PDF file extraction, returns verbatim text
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import pdf from "pdf-parse";
import { createLogger } from "../utils/logger";

export const extractTranscriptTool = createTool({
  id: "extract-transcript-from-file",
  description: "Extracts verbatim text content from uploaded transcript files (TXT or PDF). Use this when a user uploads a file to get the raw transcript text.",
  
  inputSchema: z.object({
    fileBuffer: z.instanceof(Buffer).describe("Buffer containing the file data"),
    fileName: z.string().describe("Name of the file being processed"),
    fileType: z.enum(["txt", "pdf", "text/plain", "application/pdf"]).describe("MIME type or extension of the file"),
  }),
  
  outputSchema: z.object({
    text: z.string().describe("Extracted transcript text"),
    pageCount: z.number().optional().describe("Number of pages (for PDF)"),
    wordCount: z.number().describe("Approximate word count"),
    success: z.boolean().describe("Whether extraction was successful"),
    error: z.string().optional().describe("Error message if extraction failed"),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = createLogger(mastra, "ExtractTranscriptTool");
    const { fileBuffer, fileName, fileType } = context;
    
    logger.toolStart("extract-transcript-from-file", { fileName, fileType });
    
    try {
      let extractedText = "";
      let pageCount: number | undefined;
      
      // Normalize file type
      const normalizedType = fileType.toLowerCase();
      
      if (normalizedType.includes("pdf") || normalizedType === "pdf") {
        // Extract from PDF
        logger.progress("Extracting text from PDF...");
        
        try {
          const pdfData = await pdf(fileBuffer);
          extractedText = pdfData.text;
          pageCount = pdfData.numpages;
          
          logger.progress("PDF extraction complete", {
            pages: pageCount,
            textLength: extractedText.length,
          });
        } catch (pdfError) {
          logger.toolError("extract-transcript-from-file", pdfError as Error);
          return {
            text: "",
            wordCount: 0,
            success: false,
            error: `PDF extraction failed: ${pdfError instanceof Error ? pdfError.message : "Unknown error"}`,
          };
        }
      } else if (normalizedType.includes("text") || normalizedType === "txt") {
        // Extract from TXT
        logger.progress("Extracting text from TXT file...");
        extractedText = fileBuffer.toString("utf-8");
        
        logger.progress("TXT extraction complete", {
          textLength: extractedText.length,
        });
      } else {
        // Unsupported file type, try as text anyway
        logger.warn("Unsupported file type, attempting to read as text", { fileType });
        extractedText = fileBuffer.toString("utf-8");
      }
      
      // Validate extraction
      if (!extractedText || extractedText.trim().length === 0) {
        logger.error("No text content extracted from file");
        return {
          text: "",
          wordCount: 0,
          success: false,
          error: "File appears to be empty or contains no extractable text",
        };
      }
      
      // Calculate word count
      const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;
      
      logger.toolComplete("extract-transcript-from-file", {
        wordCount,
        pageCount,
        textLength: extractedText.length,
      });
      
      return {
        text: extractedText,
        pageCount,
        wordCount,
        success: true,
      };
    } catch (error) {
      logger.toolError("extract-transcript-from-file", error as Error);
      return {
        text: "",
        wordCount: 0,
        success: false,
        error: `Extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
