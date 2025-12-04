/**
 * API Types for MeetyAI Backend
 *
 * These types define the standardized request/response contracts for the
 * HTTP API that n8n, Slack, and other clients use to interact with the
 * MeetyAI transcript analysis service.
 */

import { z } from 'zod';

// ============================================================================
// REQUEST TYPES
// ============================================================================

/**
 * Source types for transcript ingestion
 */
export const TranscriptSourceSchema = z.enum([
  'zoom',
  'slack_upload',
  'slack_text',
  'external_link',
  'n8n_workflow',
  'api_webhook',
  'manual'
]);

export type TranscriptSource = z.infer<typeof TranscriptSourceSchema>;

/**
 * Metadata that can be attached to a transcript
 */
export const TranscriptMetadataSchema = z.object({
  zoomMeetingId: z.string().optional(),
  slackChannelId: z.string().optional(),
  slackUserId: z.string().optional(),
  slackMessageTs: z.string().optional(),
  language: z.string().optional(),
  tags: z.array(z.string()).optional(),
  participants: z.array(z.string()).optional(),
  duration: z.number().optional(), // in seconds
  recordingUrl: z.string().url().optional(),
  customFields: z.record(z.any()).optional()
}).strict();

export type TranscriptMetadata = z.infer<typeof TranscriptMetadataSchema>;

/**
 * Request body for POST /api/analyze-transcript
 */
export const AnalyzeTranscriptRequestSchema = z.object({
  callId: z.string().describe('Unique identifier for this call/transcript'),
  source: TranscriptSourceSchema,
  startedAt: z.string().datetime().optional().describe('ISO 8601 timestamp of when the call started'),
  topic: z.string().optional().describe('Short title or topic of the call'),
  transcript: z.string().min(10).describe('Full transcript text to analyze'),
  metadata: TranscriptMetadataSchema.optional()
}).strict();

export type AnalyzeTranscriptRequest = z.infer<typeof AnalyzeTranscriptRequestSchema>;

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Insight types extracted from transcripts
 */
export const InsightTypeSchema = z.enum([
  'pain_point',
  'gain',
  'idea',
  'opportunity',
  'risk',
  'feature_request',
  'blocker',
  'confusion',
  'question',
  'objection',
  'buying_signal',
  'feedback',
  'outcome'
]);

export type InsightType = z.infer<typeof InsightTypeSchema>;

/**
 * Severity levels for insights
 */
export const SeveritySchema = z.enum(['high', 'medium', 'low']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Individual insight extracted from a transcript
 */
export const InsightSchema = z.object({
  id: z.string().describe('Stable unique identifier for this insight'),
  type: InsightTypeSchema,
  text: z.string().describe('Detailed description of the insight'),
  evidence: z.string().optional().describe('Verbatim quote from transcript with timestamp'),
  confidence: z.number().min(0).max(1).describe('Confidence score (0-1) based on evidence clarity'),
  severity: SeveritySchema,
  area: z.string().optional().describe('Product area (e.g., onboarding, billing, UX)'),
  suggestedActions: z.array(z.string()).optional().describe('Suggested follow-up actions or tasks'),
  timestamp: z.string().optional().describe('Timestamp in transcript where this was mentioned'),
  speaker: z.string().optional().describe('Speaker who mentioned this insight')
}).strict();

export type Insight = z.infer<typeof InsightSchema>;

/**
 * Context classification for the transcript
 */
export const TranscriptContextSchema = z.enum([
  'research_call',
  'feedback_session',
  'usability_testing',
  'sales_demo',
  'support_call',
  'onboarding',
  'brainstorm',
  'retrospective',
  'general_interview',
  'unknown'
]);

export type TranscriptContext = z.infer<typeof TranscriptContextSchema>;

/**
 * Response body for POST /api/analyze-transcript
 */
export const AnalyzeTranscriptResponseSchema = z.object({
  callId: z.string(),
  source: TranscriptSourceSchema,
  context: TranscriptContextSchema.optional().describe('Classified context of the transcript'),
  summary: z.string().describe('Short human-readable summary of the call'),
  insights: z.array(InsightSchema),
  metadata: z.object({
    processingTimeMs: z.number().optional(),
    model: z.string().optional().describe('LLM model used for analysis'),
    insightCount: z.number().describe('Total number of insights extracted'),
    confidenceDistribution: z.object({
      high: z.number().describe('Count of high confidence insights (>0.8)'),
      medium: z.number().describe('Count of medium confidence insights (0.5-0.8)'),
      low: z.number().describe('Count of low confidence insights (<0.5)')
    }).optional()
  }).optional()
}).strict();

export type AnalyzeTranscriptResponse = z.infer<typeof AnalyzeTranscriptResponseSchema>;

// ============================================================================
// ERROR RESPONSE
// ============================================================================

/**
 * Standardized error response
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().describe('Machine-readable error code'),
    message: z.string().describe('Human-readable error message'),
    details: z.any().optional().describe('Additional error context')
  })
}).strict();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ============================================================================
// INTERNAL SERVICE TYPES
// ============================================================================

/**
 * Internal type for the transcript analysis service
 * This is what the core service function accepts
 */
export interface TranscriptInput {
  callId: string;
  source: TranscriptSource;
  startedAt?: string;
  topic?: string;
  transcript: string;
  metadata?: TranscriptMetadata;
  userId?: string; // Internal: Slack user ID or account identifier
}

/**
 * Internal type for analysis results
 */
export interface AnalysisResult {
  callId: string;
  source: TranscriptSource;
  context?: TranscriptContext;
  summary: string;
  insights: Insight[];
  transcriptId?: string; // Database ID if saved
  processingTimeMs?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Maps internal insight data to API response format
 */
export function mapInsightTypeFromInternal(internalType: string): InsightType {
  const mapping: Record<string, InsightType> = {
    'pain': 'pain_point',
    'blocker': 'blocker',
    'confusion': 'confusion',
    'question': 'question',
    'feature_request': 'feature_request',
    'idea': 'idea',
    'gain': 'gain',
    'outcome': 'outcome',
    'opportunity': 'opportunity',
    'objection': 'objection',
    'buying_signal': 'buying_signal',
    'insight': 'feedback',
    'feedback': 'feedback',
    'risk': 'risk'
  };

  return mapping[internalType] || 'feedback';
}

/**
 * Calculates severity based on confidence and type
 */
export function calculateSeverity(confidence: number, type: InsightType): Severity {
  if (type === 'blocker' || type === 'risk') {
    return confidence > 0.7 ? 'high' : 'medium';
  }

  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/**
 * Validates and parses an AnalyzeTranscriptRequest
 */
export function validateAnalyzeRequest(body: unknown): AnalyzeTranscriptRequest {
  return AnalyzeTranscriptRequestSchema.parse(body);
}

/**
 * Validates and constructs an AnalyzeTranscriptResponse
 */
export function validateAnalyzeResponse(data: unknown): AnalyzeTranscriptResponse {
  return AnalyzeTranscriptResponseSchema.parse(data);
}
