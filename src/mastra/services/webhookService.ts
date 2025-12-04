/**
 * Webhook Service
 *
 * Handles outbound webhooks to send analysis results to external systems (n8n, Zapier, etc.)
 */

import type { AnalysisResult, Insight } from '../../types/api';

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  url: string;
  enabled?: boolean;
  retryAttempts?: number;
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * Webhook payload sent to n8n or other external systems
 */
export interface WebhookPayload {
  event: 'analysis.completed' | 'analysis.failed';
  timestamp: string;
  callId: string;
  source: string;

  // Analysis results (only present for analysis.completed)
  result?: {
    context?: string;
    summary: string;
    insights: WebhookInsight[];
    metadata: {
      processingTimeMs?: number;
      model?: string;
      insightCount: number;
      highConfidenceCount: number;
      mediumConfidenceCount: number;
      lowConfidenceCount: number;
    };
  };

  // Error info (only present for analysis.failed)
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Insight format for webhook payload
 * Simplified and flattened for easy consumption by n8n/integrations
 */
export interface WebhookInsight {
  id: string;
  type: string;
  title: string;
  description: string;
  evidence?: string;
  confidence: number;
  confidencePercent: number; // 0-100 for easier display
  severity: 'high' | 'medium' | 'low';
  area?: string;
  suggestedActions?: string[];
  timestamp?: string;
  speaker?: string;
}

/**
 * Send analysis results to configured webhook URL
 */
export async function sendWebhook(
  config: WebhookConfig,
  result: AnalysisResult,
  logger?: any
): Promise<{ success: boolean; error?: string }> {
  if (!config.enabled) {
    logger?.info('📤 [Webhook] Skipping webhook (disabled)');
    return { success: true };
  }

  if (!config.url) {
    logger?.warn('⚠️ [Webhook] No webhook URL configured');
    return { success: false, error: 'No webhook URL configured' };
  }

  const payload: WebhookPayload = {
    event: 'analysis.completed',
    timestamp: new Date().toISOString(),
    callId: result.callId,
    source: result.source,
    result: {
      context: result.context,
      summary: result.summary,
      insights: mapInsightsForWebhook(result.insights),
      metadata: {
        processingTimeMs: result.processingTimeMs,
        model: 'claude-sonnet-4-5',
        insightCount: result.insights.length,
        highConfidenceCount: result.insights.filter(i => i.confidence >= 0.8).length,
        mediumConfidenceCount: result.insights.filter(i => i.confidence >= 0.5 && i.confidence < 0.8).length,
        lowConfidenceCount: result.insights.filter(i => i.confidence < 0.5).length,
      },
    },
  };

  logger?.info('📤 [Webhook] Sending analysis results to webhook', {
    url: config.url,
    callId: result.callId,
    insightCount: result.insights.length,
  });

  const maxRetries = config.retryAttempts || 3;
  const timeout = config.timeout || 30000; // 30 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MeetyAI/1.0',
          ...config.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read response');
        throw new Error(`Webhook returned ${response.status}: ${errorText}`);
      }

      logger?.info('✅ [Webhook] Successfully sent to webhook', {
        url: config.url,
        callId: result.callId,
        status: response.status,
        attempt,
      });

      return { success: true };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger?.error(`❌ [Webhook] Attempt ${attempt}/${maxRetries} failed`, {
        url: config.url,
        callId: result.callId,
        error: errorMessage,
      });

      // If this was the last attempt, return failure
      if (attempt === maxRetries) {
        return {
          success: false,
          error: `Failed after ${maxRetries} attempts: ${errorMessage}`
        };
      }

      // Wait before retrying (exponential backoff: 2s, 4s, 8s)
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return { success: false, error: 'Unexpected error in webhook retry loop' };
}

/**
 * Send error notification to webhook
 */
export async function sendWebhookError(
  config: WebhookConfig,
  callId: string,
  source: string,
  error: Error,
  logger?: any
): Promise<{ success: boolean; error?: string }> {
  if (!config.enabled || !config.url) {
    return { success: true };
  }

  const payload: WebhookPayload = {
    event: 'analysis.failed',
    timestamp: new Date().toISOString(),
    callId,
    source,
    error: {
      message: error.message,
      code: 'ANALYSIS_FAILED',
    },
  };

  logger?.info('📤 [Webhook] Sending error notification to webhook', {
    url: config.url,
    callId,
  });

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MeetyAI/1.0',
        ...config.headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }

    logger?.info('✅ [Webhook] Error notification sent successfully');
    return { success: true };

  } catch (webhookError) {
    logger?.error('❌ [Webhook] Failed to send error notification', {
      error: webhookError instanceof Error ? webhookError.message : String(webhookError),
    });
    return {
      success: false,
      error: webhookError instanceof Error ? webhookError.message : String(webhookError)
    };
  }
}

/**
 * Map insights to webhook-friendly format
 */
function mapInsightsForWebhook(insights: Insight[]): WebhookInsight[] {
  return insights.map(insight => ({
    id: insight.id,
    type: insight.type,
    title: insight.text.substring(0, 100), // Use first 100 chars as title
    description: insight.text,
    evidence: insight.evidence,
    confidence: insight.confidence,
    confidencePercent: Math.round(insight.confidence * 100),
    severity: insight.severity,
    area: insight.area,
    suggestedActions: insight.suggestedActions,
    timestamp: insight.timestamp,
    speaker: insight.speaker,
  }));
}

/**
 * Get webhook configuration from environment or database
 */
export function getWebhookConfig(logger?: any): WebhookConfig {
  // Priority 1: Environment variable (for simple setups)
  const webhookUrl = process.env.N8N_WEBHOOK_URL || process.env.WEBHOOK_URL;

  if (webhookUrl) {
    logger?.info('📋 [Webhook] Using webhook URL from environment', {
      url: webhookUrl,
    });

    return {
      url: webhookUrl,
      enabled: true,
      retryAttempts: 3,
      timeout: 30000,
    };
  }

  // Priority 2: Could load from database (future enhancement)
  // const dbConfig = await loadWebhookConfigFromDatabase(userId);

  logger?.info('ℹ️ [Webhook] No webhook URL configured');

  return {
    url: '',
    enabled: false,
  };
}
