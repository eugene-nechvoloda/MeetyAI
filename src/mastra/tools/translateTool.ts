/**
 * Translate Tool
 * 
 * Detects language and translates to English if needed using Claude
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Anthropic } from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";
import { getPrisma } from "../utils/database";

export const translateTool = createTool({
  id: "translate-to-english",
  description: "Detects the language of transcript text and translates to English if needed. Use this after extracting text to ensure all analysis is done in English.",
  
  inputSchema: z.object({
    text: z.string().describe("Text to detect language and potentially translate"),
    maxLength: z.number().optional().default(100000).describe("Maximum text length to process"),
  }),
  
  outputSchema: z.object({
    translatedText: z.string().describe("Text in English (original if already English)"),
    detectedLanguage: z.string().describe("ISO language code of detected language"),
    wasTranslated: z.boolean().describe("Whether translation was performed"),
    success: z.boolean().describe("Whether operation was successful"),
    error: z.string().optional().describe("Error message if failed"),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = createLogger(mastra, "TranslateTool");
    const { text, maxLength } = context;
    
    logger.toolStart("translate-to-english", {
      textLength: text.length,
      maxLength,
    });
    
    try {
      // Truncate if too long
      const textToAnalyze = text.length > maxLength 
        ? text.substring(0, maxLength)
        : text;
      
      // Get Claude API key from database settings
      const prisma = getPrisma();
      const claudeConfig = await prisma.modelConfig.findFirst({
        where: {
          provider: "anthropic",
          model_type: "analysis",
        },
      });
      
      if (!claudeConfig) {
        logger.warn("Claude not configured, skipping language detection and translation");
        return {
          translatedText: text,
          detectedLanguage: "en",
          wasTranslated: false,
          success: true,
        };
      }
      
      // Decrypt API key
      const { decrypt } = await import("../utils/encryption");
      const apiKey = decrypt(claudeConfig.api_key_encrypted);
      
      // Initialize Anthropic client
      const anthropic = new Anthropic({ apiKey });
      
      // Detect language
      logger.progress("Detecting language...");
      
      const detectPrompt = `Detect the primary language of the following text. Respond with ONLY the ISO 639-1 two-letter language code (e.g., "en", "es", "fr", "de", etc.). Nothing else.

Text:
${textToAnalyze.substring(0, 2000)}`;
      
      const detectResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 10,
        temperature: 0,
        messages: [{
          role: "user",
          content: detectPrompt,
        }],
      });
      
      const detectedLanguage = (detectResponse.content[0] as any).text.trim().toLowerCase();
      
      logger.progress("Language detected", { detectedLanguage });
      
      // If already English, return as-is
      if (detectedLanguage === "en" || detectedLanguage === "english") {
        logger.toolComplete("translate-to-english", {
          detectedLanguage: "en",
          wasTranslated: false,
        });
        
        return {
          translatedText: text,
          detectedLanguage: "en",
          wasTranslated: false,
          success: true,
        };
      }
      
      // Translate to English
      logger.progress("Translating to English...", { from: detectedLanguage });
      
      const translatePrompt = `Translate the following text to English. Preserve all timestamps, speaker names, and structural elements. Provide ONLY the translation, no explanations.

Text to translate:
${text}`;
      
      const translateResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 100000,
        temperature: 0,
        messages: [{
          role: "user",
          content: translatePrompt,
        }],
      });
      
      const translatedText = (translateResponse.content[0] as any).text;
      
      logger.toolComplete("translate-to-english", {
        detectedLanguage,
        wasTranslated: true,
        translatedLength: translatedText.length,
      });
      
      return {
        translatedText,
        detectedLanguage,
        wasTranslated: true,
        success: true,
      };
    } catch (error) {
      logger.toolError("translate-to-english", error as Error);
      
      // Return original text on error
      return {
        translatedText: text,
        detectedLanguage: "unknown",
        wasTranslated: false,
        success: false,
        error: `Translation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
