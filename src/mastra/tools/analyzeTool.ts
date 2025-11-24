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
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

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
  type: z.enum(["pain", "blocker", "feature_request", "idea", "gain", "outcome", "objection", "buying_signal", "question", "feedback", "confusion", "opportunity", "insight", "other"]),
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
      
      // Step 0: Context Classification using GPT-5
      logger.progress("🎯 Classifying conversation context...");
      
      const openai = createOpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      });
      
      const classificationPrompt = `Analyze this transcript and classify the conversation context/atmosphere.

CONTEXT TYPES:
- research_call: Discovery interview, user research, exploratory conversation to understand needs
- feedback_session: Gathering feedback on specific feature/product, user reactions to existing functionality
- usability_testing: Testing specific workflows, observing user interactions, task completion
- sales_demo: Product demonstration, sales pitch, qualifying lead
- support_call: Customer support, troubleshooting, issue resolution
- onboarding: New user onboarding, training, getting started
- general_interview: General discussion, mixed topics, informal conversation

Respond with a JSON object in this exact format:
{
  "theme": "context_type",
  "confidence": 0.85,
  "reasoning": "Brief explanation of classification",
  "key_indicators": ["indicator 1", "indicator 2"]
}

TRANSCRIPT:
${transcriptText.slice(0, 4000)}`;

      let contextTheme = "general_interview";
      let contextConfidence = 0.5;
      
      try {
        const { text: classificationText } = await generateText({
          model: openai.responses("gpt-5"),
          prompt: classificationPrompt,
          temperature: 0.3,
        });
        
        const jsonMatch = classificationText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const classification = JSON.parse(jsonMatch[0]);
          contextTheme = classification.theme || "general_interview";
          contextConfidence = classification.confidence || 0.5;
          
          logger.progress(`📊 Context classified: ${contextTheme} (${(contextConfidence * 100).toFixed(0)}% confidence)`, {
            reasoning: classification.reasoning,
            indicators: classification.key_indicators,
          });
          
          // Store context in database
          await prisma.transcript.update({
            where: { id: transcriptId },
            data: {
              context_theme: contextTheme,
              context_confidence: contextConfidence,
            },
          });
        }
      } catch (error) {
        logger.warn("Context classification failed, using default", { error });
      }
      
      const allInsights: any[] = [];
      
      // Define context-aware focus for each pass
      const contextFocusMap: Record<string, { priority: string[], secondary: string[] }> = {
        research_call: {
          priority: ["opportunity", "insight", "confusion", "question"],
          secondary: ["pain", "blocker", "gain"],
        },
        feedback_session: {
          priority: ["pain", "gain", "feedback", "feature_request"],
          secondary: ["confusion", "idea", "objection"],
        },
        usability_testing: {
          priority: ["confusion", "blocker", "pain", "question"],
          secondary: ["feature_request", "idea"],
        },
        sales_demo: {
          priority: ["buying_signal", "objection", "question"],
          secondary: ["gain", "outcome", "feature_request"],
        },
        support_call: {
          priority: ["blocker", "pain", "confusion"],
          secondary: ["feedback", "feature_request"],
        },
        onboarding: {
          priority: ["confusion", "question", "blocker"],
          secondary: ["feedback", "gain"],
        },
        general_interview: {
          priority: ["pain", "feature_request", "gain", "objection"],
          secondary: [],
        },
      };
      
      const contextFocus = contextFocusMap[contextTheme] || contextFocusMap.general_interview;
      
      // Define the 4 passes with context-aware instructions
      const passes = [
        { 
          number: 1, 
          types: ["pain", "blocker", "confusion", "question"], 
          focus: "Problems, frustrations, challenges, blockers, confusion, unclear requirements, and questions",
          contextNote: contextFocus.priority.some(t => ["pain", "blocker", "confusion", "question"].includes(t)) 
            ? `⚡ HIGH PRIORITY for ${contextTheme}: Pay extra attention to these insight types as they are critical for this context.`
            : "",
        },
        { 
          number: 2, 
          types: ["feature_request", "idea"], 
          focus: "Feature requests, ideas, and suggestions",
          contextNote: contextFocus.priority.some(t => ["feature_request", "idea"].includes(t)) 
            ? `⚡ HIGH PRIORITY for ${contextTheme}: These insights are especially valuable in this context.`
            : "",
        },
        { 
          number: 3, 
          types: ["gain", "outcome", "opportunity"], 
          focus: "Wins, positive outcomes, benefits achieved, and potential opportunities",
          contextNote: contextFocus.priority.some(t => ["gain", "outcome", "opportunity"].includes(t)) 
            ? `⚡ HIGH PRIORITY for ${contextTheme}: Focus on extracting these as they align with the conversation's purpose.`
            : "",
        },
        { 
          number: 4, 
          types: ["objection", "buying_signal", "insight", "feedback"], 
          focus: "Objections, concerns, buying signals, general insights, and feedback",
          contextNote: contextFocus.priority.some(t => ["objection", "buying_signal", "insight", "feedback"].includes(t)) 
            ? `⚡ HIGH PRIORITY for ${contextTheme}: These are key indicators for this type of conversation.`
            : "",
        },
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

CONVERSATION CONTEXT: This transcript has been classified as "${contextTheme}" with ${(contextConfidence * 100).toFixed(0)}% confidence.
${pass.contextNote ? `\n${pass.contextNote}\n` : ""}

Analyze the following transcript and extract insights related to: ${pass.focus}

For each insight:
1. Create a clear title (50-70 characters)
2. Write a concise description (max 200 characters)
3. Provide verbatim quotes as evidence (with timestamps if available)
4. Assign confidence score (0.0-1.0) based on clarity and repetition
5. Categorize as one of: ${pass.types.join(", ")}

Extract at least 10 insights if the transcript supports it. Quality over quantity.

TYPE DEFINITIONS:
- pain: Customer frustration or dissatisfaction
- blocker: Technical or process obstacle preventing progress
- confusion: Unclear requirements, misunderstanding, or lack of clarity
- question: Direct questions or uncertainties expressed
- feature_request: Explicit request for new functionality
- idea: Suggestion or proposal for improvement
- gain: Positive outcome or benefit achieved
- outcome: Result or achievement from using product/service
- opportunity: Potential business or product opportunity identified
- objection: Concern or hesitation about product/solution
- buying_signal: Indication of purchase intent or readiness
- insight: General observation or realization
- feedback: General commentary or evaluation

Respond with a JSON array of insights in this exact format:
[
  {
    "title": "Clear insight title 50-70 chars",
    "description": "Brief description under 200 chars",
    "type": "pain|blocker|confusion|question|feature_request|idea|gain|outcome|opportunity|objection|buying_signal|insight|feedback",
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
