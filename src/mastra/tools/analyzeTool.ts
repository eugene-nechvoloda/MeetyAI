/**
 * Four-Pass Analysis Tool
 * 
 * Implements 0.7 research depth with 4-pass extraction:
 * Pass 1: Pains/Blockers
 * Pass 2: Features/Ideas
 * Pass 3: Gains/Outcomes
 * Pass 4: Objections/Buying Signals
 * 
 * Extracts 10+ verbatim quotes per hour with timestamps, confidence scoring, and duplicate flagging
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Anthropic } from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";
import { getPrisma } from "../utils/database";
import cosineSimilarity from "cosine-similarity";

// Evidence quote structure
const evidenceQuoteSchema = z.object({
  quote: z.string(),
  timestamp: z.string().optional(),
  speaker: z.string().optional(),
});

// Insight structure
const insightSchema = z.object({
  title: z.string().min(10).max(70),
  description: z.string().max(200),
  type: z.enum(["pain", "blocker", "feature_request", "idea", "gain", "outcome", "objection", "buying_signal", "question", "feedback", "other"]),
  evidence: z.array(evidenceQuoteSchema).min(1),
  confidence: z.number().min(0).max(1),
  timestamp_start: z.string().optional(),
  timestamp_end: z.string().optional(),
  speaker: z.string().optional(),
});

export const analyzeTool = createTool({
  id: "analyze-four-pass-extraction",
  description: "Performs deep 4-pass analysis on transcript to extract insights (pains, features, gains, objections) with verbatim evidence. This is the core analysis tool that implements MeetyAI's research depth of 0.7.",
  
  inputSchema: z.object({
    transcriptId: z.string().describe("Database ID of the transcript to analyze"),
    transcriptText: z.string().describe("Full transcript text to analyze"),
    userContext: z.string().optional().describe("Additional context about the user/meeting"),
  }),
  
  outputSchema: z.object({
    insights: z.array(insightSchema),
    totalPasses: z.number(),
    processingTime: z.number(),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = createLogger(mastra, "AnalyzeTool");
    const { transcriptId, transcriptText, userContext } = context;
    
    const startTime = Date.now();
    logger.toolStart("analyze-four-pass-extraction", {
      transcriptId,
      textLength: transcriptText.length,
    });
    
    try {
      // Get Claude API key
      const prisma = getPrisma();
      const claudeConfig = await prisma.modelConfig.findFirst({
        where: {
          provider: "anthropic",
          model_type: "analysis",
        },
      });
      
      if (!claudeConfig) {
        throw new Error("Claude not configured for analysis. Please add API key in Settings > Models.");
      }
      
      const { decrypt } = await import("../utils/encryption");
      const apiKey = decrypt(claudeConfig.api_key_encrypted);
      const anthropic = new Anthropic({ apiKey });
      
      const allInsights: any[] = [];
      
      // Define the 4 passes
      const passes = [
        { number: 1, types: ["pain", "blocker"], focus: "Problems, frustrations, challenges, and blockers" },
        { number: 2, types: ["feature_request", "idea"], focus: "Feature requests, ideas, and suggestions" },
        { number: 3, types: ["gain", "outcome"], focus: "Wins, positive outcomes, and benefits achieved" },
        { number: 4, types: ["objection", "buying_signal"], focus: "Objections, concerns, and buying signals" },
      ];
      
      // Anti-hallucination protocol system prompt
      const antiHallucinationPrompt = `You are a transcript analyst following strict anti-hallucination protocol:

CRITICAL RULES:
1. Extract ONLY verbatim quotes from the transcript - never invent or paraphrase
2. Include exact timestamps if present in the transcript
3. If you cannot find evidence for something, DO NOT include it
4. Confidence score must reflect clarity and repetition in the transcript
5. Never fabricate speakers, quotes, timestamps, or any other data
6. If information is unclear or conflicts, state it explicitly in your response

You will analyze transcripts and extract insights with evidence.`;
      
      // Execute each pass
      for (const pass of passes) {
        logger.analysis(pass.number, { focus: pass.focus });
        
        const passPrompt = `${antiHallucinationPrompt}

PASS ${pass.number}/4: ${pass.focus}

Analyze the following transcript and extract insights related to: ${pass.focus}

For each insight:
1. Create a clear title (50-70 characters)
2. Write a concise description (max 200 characters)
3. Provide verbatim quotes as evidence (with timestamps if available)
4. Assign confidence score (0.0-1.0) based on clarity and repetition
5. Categorize as one of: ${pass.types.join(", ")}

Extract at least 10 insights if the transcript supports it. Quality over quantity.

Respond with a JSON array of insights in this exact format:
[
  {
    "title": "Clear insight title 50-70 chars",
    "description": "Brief description under 200 chars",
    "type": "pain|blocker|feature_request|idea|gain|outcome|objection|buying_signal",
    "evidence": [
      {
        "quote": "Exact verbatim quote from transcript",
        "timestamp": "00:15:30",
        "speaker": "Speaker name if available"
      }
    ],
    "confidence": 0.85,
    "timestamp_start": "00:15:30",
    "speaker": "Speaker name"
  }
]

TRANSCRIPT:
${transcriptText}`;
        
        try {
          const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 16000,
            temperature: 0.35, // Research depth 0.7 → temp 0.35
            messages: [{
              role: "user",
              content: passPrompt,
            }],
          });
          
          const responseText = (response.content[0] as any).text;
          
          // Extract JSON from response
          const jsonMatch = responseText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const passInsights = JSON.parse(jsonMatch[0]);
            allInsights.push(...passInsights);
            
            logger.progress(`Pass ${pass.number} complete`, {
              insightsExtracted: passInsights.length,
            });
          } else {
            logger.warn(`Pass ${pass.number} returned no valid JSON`);
          }
        } catch (passError) {
          logger.error(`Pass ${pass.number} failed`, {
            error: passError instanceof Error ? passError.message : "Unknown error",
          });
          // Continue with other passes
        }
      }
      
      // Flag duplicates using cosine similarity on titles and descriptions
      logger.progress("Flagging duplicates...");
      
      for (let i = 0; i < allInsights.length; i++) {
        for (let j = i + 1; j < allInsights.length; j++) {
          const text1 = `${allInsights[i].title} ${allInsights[i].description}`.toLowerCase();
          const text2 = `${allInsights[j].title} ${allInsights[j].description}`.toLowerCase();
          
          // Simple word-based similarity
          const words1 = text1.split(/\s+/);
          const words2 = text2.split(/\s+/);
          const allWords = [...new Set([...words1, ...words2])];
          
          const vec1 = allWords.map(w => words1.filter(w2 => w2 === w).length);
          const vec2 = allWords.map(w => words2.filter(w2 => w2 === w).length);
          
          const similarity = cosineSimilarity(vec1, vec2);
          
          if (similarity > 0.92) {
            allInsights[j].is_duplicate = true;
            allInsights[j].duplicate_of_id = i;
            allInsights[j].duplicate_similarity = similarity;
            
            logger.debug("Duplicate flagged", {
              original: allInsights[i].title,
              duplicate: allInsights[j].title,
              similarity,
            });
          }
        }
      }
      
      const processingTime = Math.floor((Date.now() - startTime) / 1000);
      
      logger.toolComplete("analyze-four-pass-extraction", {
        totalInsights: allInsights.length,
        duplicates: allInsights.filter((i: any) => i.is_duplicate).length,
        processingTime,
      });
      
      return {
        insights: allInsights,
        totalPasses: 4,
        processingTime,
        success: true,
      };
    } catch (error) {
      logger.toolError("analyze-four-pass-extraction", error as Error);
      
      const processingTime = Math.floor((Date.now() - startTime) / 1000);
      
      return {
        insights: [],
        totalPasses: 0,
        processingTime,
        success: false,
        error: `Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
