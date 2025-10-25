/**
 * Logger Utility
 * 
 * Provides consistent logging helpers with emoji prefixes
 */

import type { IMastraLogger } from "@mastra/core/logger";

export class MetiyLogger {
  private logger?: IMastraLogger;
  private context: string;

  constructor(logger: IMastraLogger | undefined, context: string) {
    this.logger = logger;
    this.context = context;
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.logger?.info(`[${this.context}] ${message}`, data || {});
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger?.debug(`[${this.context}] ${message}`, data || {});
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.logger?.error(`❌ [${this.context}] ${message}`, data || {});
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.logger?.warn(`⚠️ [${this.context}] ${message}`, data || {});
  }

  // Specific logging methods with emoji prefixes
  toolStart(toolName: string, params?: Record<string, unknown>): void {
    this.info(`🔧 [${toolName}] Starting execution`, params);
  }

  toolComplete(toolName: string, result?: Record<string, unknown>): void {
    this.info(`✅ [${toolName}] Completed successfully`, result);
  }

  toolError(toolName: string, error: Error | string): void {
    this.error(`[${toolName}] Error occurred`, {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  progress(step: string, details?: Record<string, unknown>): void {
    this.info(`📝 ${step}`, details);
  }

  slackEvent(eventType: string, data?: Record<string, unknown>): void {
    this.info(`💬 [Slack] ${eventType}`, data);
  }

  analysis(pass: number, details?: Record<string, unknown>): void {
    this.info(`🔍 [Analysis Pass ${pass}/4]`, details);
  }

  exportAction(provider: string, details?: Record<string, unknown>): void {
    this.info(`📤 [Export: ${provider}]`, details);
  }

  apiCall(service: string, action: string, details?: Record<string, unknown>): void {
    this.info(`🌐 [API: ${service}] ${action}`, details);
  }
}

export function createLogger(
  mastra: { getLogger?: () => IMastraLogger | undefined } | undefined,
  context: string
): MetiyLogger {
  const loggerInstance = mastra?.getLogger ? mastra.getLogger() : undefined;
  return new MetiyLogger(loggerInstance, context);
}
