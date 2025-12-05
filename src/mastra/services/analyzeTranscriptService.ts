/**
 * Core Transcript Analysis Service
 *
 * This is the unified service layer that handles transcript analysis for ALL entry points:
 * - n8n workflows (via POST /api/analyze-transcript)
 * - Slack uploads/text/commands
 * - External webhooks
 *
 * Architecture: This service layer sits between HTTP endpoints and the LLM analysis logic.
 * It provides a clean, framework-agnostic interface that returns structured JSON instead
 * of triggering async workflows or sending Slack messages.
 *
 * Key responsibilities:
 * 1. Accept standardized TranscriptInput
 * 2. Save transcript to database with deduplication
 * 3. Perform LLM analysis (4-pass extraction)
 * 4. Return structured AnalysisResult
 * 5. No side effects (no Slack messages, no exports to Airtable/Linear)
 */

import { z } from 'zod';
import { TranscriptOrigin, TranscriptStatus } from '@prisma/client';
import crypto from 'crypto';
import { createLogger as createMastraLogger } from '../utils/logger';
import { getPrismaAsync } from '../utils/database';
import type {
  TranscriptInput,
  AnalysisResult,
  Insight,
  TranscriptSource,
  TranscriptContext,
  InsightType,
  Severity,
} from '../../types/api';
import {
  mapInsightTypeFromInternal,
  calculateSeverity,
} from '../../types/api';

/**
 * Generate a SHA-256 hash of the content for deduplication
 */
function generateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
}

/**
 * Map API source types to database TranscriptOrigin enum
 */
function mapSourceToOrigin(source: TranscriptSource): TranscriptOrigin {
  const mapping: Record<TranscriptSource, TranscriptOrigin> = {
    zoom: 'zoom_import',
    slack_upload: 'slack_file_upload',
    slack_text: 'slack_text_paste',
    external_link: 'slack_external_link',
    n8n_workflow: 'webhook',
    api_webhook: 'webhook',
    manual: 'slack_text_paste',
  };
  return mapping[source];
}

/**
 * Convert database context_theme to API TranscriptContext enum
 */
function mapContextTheme(theme: string | null): TranscriptContext {
  if (!theme) return 'unknown';

  const validContexts: TranscriptContext[] = [
    'research_call',
    'feedback_session',
    'usability_testing',
    'sales_demo',
    'support_call',
    'onboarding',
    'brainstorm',
    'retrospective',
    'general_interview',
  ];

  return (validContexts.includes(theme as TranscriptContext)
    ? theme
    : 'unknown') as TranscriptContext;
}

/**
 * Options for transcript analysis
 */
export interface AnalyzeOptions {
  /**
   * Skip saving to database (useful for one-off analyses)
   */
  skipDatabase?: boolean;

  /**
   * Skip duplicate detection
   */
  skipDeduplication?: boolean;

  /**
   * Send results to webhook URL after analysis completes
   */
  sendWebhook?: boolean;

  /**
   * Custom webhook URL (overrides environment variable)
   */
  webhookUrl?: string;

  /**
   * Mastra instance (for logging and context)
   */
  mastra?: any;

  /**
   * Custom logger
   */
  logger?: any;
}

/**
 * Core service function: Analyze a transcript and return structured insights
 *
 * This is the main entry point for all transcript analysis.
 * It's framework-agnostic and returns structured JSON.
 *
 * @param input - Standardized transcript input
 * @param options - Analysis options
 * @returns Structured analysis results with insights
 */
export async function analyzeTranscript(
  input: TranscriptInput,
  options: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const logger = options.logger || createMastraLogger(options.mastra, 'AnalyzeTranscriptService');

  logger?.info('📥 [AnalyzeTranscriptService] Starting analysis', {
    callId: input.callId,
    source: input.source,
    transcriptLength: input.transcript.length,
    userId: input.userId,
  });

  try {
    const prisma = await getPrismaAsync();
    const contentHash = generateContentHash(input.transcript);

    let transcriptId: string | undefined;
    let existingTranscript: any = null;

    // Check for duplicates unless explicitly skipped
    if (!options.skipDeduplication && input.userId) {
      existingTranscript = await prisma.transcript.findFirst({
        where: {
          slack_user_id: input.userId,
          content_hash: contentHash,
          archived: false,
        },
        include: {
          insights: true,
        },
      });

      if (existingTranscript) {
        logger?.info('⏭️ [AnalyzeTranscriptService] Duplicate transcript detected, returning existing analysis', {
          transcriptId: existingTranscript.id,
          insightCount: existingTranscript.insights?.length || 0,
        });

        // Return existing analysis results
        return {
          callId: input.callId,
          source: input.source,
          context: mapContextTheme(existingTranscript.context_theme),
          summary: existingTranscript.summary || 'Analysis completed',
          insights: mapDatabaseInsightsToAPI(existingTranscript.insights || []),
          transcriptId: existingTranscript.id,
          processingTimeMs: Date.now() - startTime,
        };
      }
    }

    // Save to database unless explicitly skipped
    if (!options.skipDatabase) {
      const transcript = await prisma.transcript.create({
        data: {
          title: input.topic || `${input.source} - ${new Date().toISOString()}`,
          origin: mapSourceToOrigin(input.source),
          status: TranscriptStatus.file_uploaded,
          slack_user_id: input.userId || 'api_user',
          slack_channel_id: input.metadata?.slackChannelId || 'api',
          raw_content: input.transcript,
          transcript_text: input.transcript,
          content_hash: contentHash,
          language: input.metadata?.language || 'en',
          zoom_meeting_id: input.metadata?.zoomMeetingId,
          duration_minutes: input.metadata?.duration ? Math.round(input.metadata.duration / 60) : undefined,
          participant_count: input.metadata?.participants?.length,
          started_at: input.startedAt ? new Date(input.startedAt) : undefined,
        },
      });

      transcriptId = transcript.id;

      await prisma.transcriptActivity.create({
        data: {
          transcript_id: transcriptId,
          activity_type: 'ingestion_completed',
          message: `Transcript ingested from ${input.source} via API`,
          metadata: {
            callId: input.callId,
            contentLength: input.transcript.length,
            source: input.source,
          },
        },
      });

      logger?.info('✅ [AnalyzeTranscriptService] Transcript saved', {
        transcriptId,
        contentHash,
      });
    }

    // Perform LLM analysis
    logger?.info('🤖 [AnalyzeTranscriptService] Starting LLM analysis');

    const analysisResults = await performLLMAnalysis(
      transcriptId || crypto.randomUUID(),
      input.transcript,
      input.metadata,
      options
    );

    // Update transcript status if saved to database
    if (transcriptId) {
      await prisma.transcript.update({
        where: { id: transcriptId },
        data: {
          status: TranscriptStatus.completed,
          processed_at: new Date(),
          summary: analysisResults.summary,
          context_theme: analysisResults.context,
        },
      });

      await prisma.transcriptActivity.create({
        data: {
          transcript_id: transcriptId,
          activity_type: 'analysis_completed',
          message: `Analysis completed with ${analysisResults.insights.length} insights`,
          metadata: {
            insightCount: analysisResults.insights.length,
            processingTimeMs: Date.now() - startTime,
          },
        },
      });
    }

    const result: AnalysisResult = {
      callId: input.callId,
      source: input.source,
      context: analysisResults.context,
      summary: analysisResults.summary,
      insights: analysisResults.insights,
      transcriptId,
      processingTimeMs: Date.now() - startTime,
    };

    logger?.info('✅ [AnalyzeTranscriptService] Analysis completed', {
      callId: input.callId,
      transcriptId,
      insightCount: result.insights.length,
      processingTimeMs: result.processingTimeMs,
    });

    // Send results to webhook if configured
    if (options.sendWebhook) {
      const { sendWebhook, getWebhookConfig } = await import('./webhookService');

      const webhookConfig = options.webhookUrl
        ? { url: options.webhookUrl, enabled: true, retryAttempts: 3, timeout: 30000 }
        : getWebhookConfig(logger);

      if (webhookConfig.enabled && webhookConfig.url) {
        // Send webhook asynchronously (don't block the response)
        sendWebhook(webhookConfig, result, logger).catch((error) => {
          logger?.error('❌ [AnalyzeTranscriptService] Webhook failed', {
            error: error instanceof Error ? error.message : String(error),
            callId: input.callId,
          });
        });

        logger?.info('📤 [AnalyzeTranscriptService] Webhook dispatch initiated', {
          url: webhookConfig.url,
          callId: input.callId,
        });
      }
    }

    return result;
  } catch (error) {
    logger?.error('❌ [AnalyzeTranscriptService] Analysis failed', {
      error: error instanceof Error ? error.message : String(error),
      callId: input.callId,
    });

    throw new Error(
      `Transcript analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Perform the actual LLM analysis using the existing analyze tool
 * This wraps the analyzeTool execution and converts results to API format
 */
async function performLLMAnalysis(
  transcriptId: string,
  transcriptText: string,
  metadata: TranscriptInput['metadata'],
  options: AnalyzeOptions
): Promise<{
  context?: TranscriptContext;
  summary: string;
  insights: Insight[];
}> {
  const logger = options.logger || createMastraLogger(options.mastra, 'LLMAnalysis');

  try {
    // Import the analyze tool
    const { analyzeTool } = await import('../tools/analyzeTool');

    // Execute the tool
    const result = await analyzeTool.execute({
      context: {
        transcriptId,
        transcriptText,
        userContext: metadata?.customFields?.context as string | undefined,
      },
      mastra: options.mastra,
    });

    if (!result.success || result.error) {
      throw new Error(result.error || 'Analysis tool returned unsuccessful result');
    }

    logger?.info('🎯 [LLMAnalysis] Tool execution completed', {
      insightCount: result.insights?.length || 0,
      totalPasses: result.totalPasses,
    });

    // Fetch the updated transcript to get context classification
    const prisma = await getPrismaAsync();
    const transcript = await prisma.transcript.findUnique({
      where: { id: transcriptId },
      select: {
        context_theme: true,
        summary: true,
      },
    });

    // Convert tool results to API format
    const insights: Insight[] = result.insights.map((insight: any, index: number) => ({
      id: crypto.randomUUID(),
      type: mapInsightTypeFromInternal(insight.type),
      text: insight.description || insight.title,
      evidence: insight.evidence_text || insight.evidence?.[0]?.quote,
      confidence: insight.confidence || 0.5,
      severity: calculateSeverity(
        insight.confidence || 0.5,
        mapInsightTypeFromInternal(insight.type)
      ),
      area: extractArea(insight.title, insight.description),
      suggestedActions: generateSuggestedActions(insight),
      timestamp: insight.timestamp_start || insight.evidence?.[0]?.timestamp,
      speaker: insight.speaker || insight.author || insight.evidence?.[0]?.speaker,
    }));

    return {
      context: mapContextTheme(transcript?.context_theme || null),
      summary: generateSummary(transcriptText, insights, transcript?.summary),
      insights,
    };
  } catch (error) {
    logger?.error('❌ [LLMAnalysis] Tool execution failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Map database insights to API format
 */
function mapDatabaseInsightsToAPI(dbInsights: any[]): Insight[] {
  return dbInsights.map((insight) => ({
    id: insight.id,
    type: mapInsightTypeFromInternal(insight.type),
    text: insight.description || insight.title,
    evidence: insight.evidence_text,
    confidence: insight.confidence || 0.5,
    severity: calculateSeverity(
      insight.confidence || 0.5,
      mapInsightTypeFromInternal(insight.type)
    ),
    area: insight.metadata?.area,
    suggestedActions: insight.metadata?.suggestedActions,
    timestamp: insight.timestamp_start,
    speaker: insight.speaker || insight.author,
  }));
}

/**
 * Extract product area from insight text
 */
function extractArea(title: string, description: string): string | undefined {
  const text = `${title} ${description}`.toLowerCase();

  const areaKeywords: Record<string, string[]> = {
    onboarding: ['onboard', 'getting started', 'first time', 'signup', 'registration'],
    billing: ['billing', 'payment', 'invoice', 'pricing', 'subscription'],
    ux: ['ui', 'ux', 'design', 'interface', 'layout', 'navigation'],
    performance: ['slow', 'performance', 'speed', 'loading', 'lag'],
    integration: ['integration', 'api', 'webhook', 'connect', 'sync'],
    reporting: ['report', 'analytics', 'dashboard', 'metrics', 'insights'],
    collaboration: ['collaborate', 'team', 'sharing', 'permission', 'access'],
  };

  for (const [area, keywords] of Object.entries(areaKeywords)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return area;
    }
  }

  return undefined;
}

/**
 * Generate suggested actions based on insight type and content
 */
function generateSuggestedActions(insight: any): string[] | undefined {
  const actions: string[] = [];

  const type = insight.type;
  const isHighConfidence = (insight.confidence || 0) >= 0.8;

  if (type === 'pain' || type === 'blocker') {
    if (isHighConfidence) {
      actions.push('Prioritize for immediate investigation');
      actions.push('Schedule follow-up with user');
    } else {
      actions.push('Monitor for similar feedback');
    }
  } else if (type === 'feature_request' || type === 'idea') {
    actions.push('Add to product backlog');
    if (isHighConfidence) {
      actions.push('Validate with additional users');
    }
  } else if (type === 'gain' || type === 'outcome') {
    actions.push('Document as success story');
    actions.push('Consider highlighting in marketing');
  } else if (type === 'objection') {
    actions.push('Prepare response for sales team');
    actions.push('Update FAQ or documentation');
  }

  return actions.length > 0 ? actions : undefined;
}

/**
 * Generate a summary of the transcript
 */
function generateSummary(
  transcriptText: string,
  insights: Insight[],
  existingSummary?: string | null
): string {
  if (existingSummary) {
    return existingSummary;
  }

  // Count insights by type
  const painCount = insights.filter((i) => i.type === 'pain_point' || i.type === 'blocker').length;
  const featureCount = insights.filter((i) => i.type === 'feature_request' || i.type === 'idea').length;
  const gainCount = insights.filter((i) => i.type === 'gain' || i.type === 'outcome').length;

  const parts: string[] = [];

  if (painCount > 0) {
    parts.push(`${painCount} pain point${painCount !== 1 ? 's' : ''}`);
  }
  if (featureCount > 0) {
    parts.push(`${featureCount} feature request${featureCount !== 1 ? 's' : ''}`);
  }
  if (gainCount > 0) {
    parts.push(`${gainCount} positive outcome${gainCount !== 1 ? 's' : ''}`);
  }

  const insightSummary = parts.length > 0 ? parts.join(', ') : `${insights.length} insights`;
  const wordCount = transcriptText.split(/\s+/).length;
  const estimatedMinutes = Math.round(wordCount / 150); // Assuming 150 words per minute

  return `Analyzed ${estimatedMinutes}-minute transcript with ${insightSummary} extracted`;
}

/**
 * Get transcript by ID with insights
 */
export async function getTranscriptWithInsights(
  transcriptId: string,
  logger?: any
): Promise<AnalysisResult | null> {
  logger?.info('🔍 [AnalyzeTranscriptService] Fetching transcript', { transcriptId });

  try {
    const prisma = await getPrismaAsync();
    const transcript = await prisma.transcript.findUnique({
      where: { id: transcriptId },
      include: {
        insights: true,
      },
    });

    if (!transcript) {
      logger?.warn('⚠️ [AnalyzeTranscriptService] Transcript not found', { transcriptId });
      return null;
    }

    return {
      callId: transcript.zoom_meeting_id || transcriptId,
      source: mapOriginToSource(transcript.origin),
      context: mapContextTheme(transcript.context_theme),
      summary: transcript.summary || 'Analysis completed',
      insights: mapDatabaseInsightsToAPI(transcript.insights),
      transcriptId: transcript.id,
    };
  } catch (error) {
    logger?.error('❌ [AnalyzeTranscriptService] Failed to fetch transcript', {
      error: String(error),
      transcriptId,
    });
    return null;
  }
}

/**
 * Map database TranscriptOrigin to API source type
 */
function mapOriginToSource(origin: TranscriptOrigin): TranscriptSource {
  const mapping: Record<TranscriptOrigin, TranscriptSource> = {
    zoom_import: 'zoom',
    slack_file_upload: 'slack_upload',
    slack_text_paste: 'slack_text',
    slack_external_link: 'external_link',
    webhook: 'api_webhook',
    fireflies_import: 'api_webhook',
  };
  return mapping[origin] || 'manual';
}
