/**
 * Prisma Types (ESM Compatible)
 * 
 * Local definitions for Prisma enums to avoid ESM/CommonJS import issues.
 * These must match the enum values in prisma/schema.prisma exactly.
 */

export const TranscriptOrigin = {
  file_upload: "file_upload",
  paste: "paste",
  link: "link",
  zoom_import: "zoom_import",
  fireflies_import: "fireflies_import",
  custom_api: "custom_api",
} as const;

export type TranscriptOrigin = (typeof TranscriptOrigin)[keyof typeof TranscriptOrigin];

export const TranscriptStatus = {
  file_uploaded: "file_uploaded",
  transcribing: "transcribing",
  translating: "translating",
  analyzing_pass_1: "analyzing_pass_1",
  analyzing_pass_2: "analyzing_pass_2",
  analyzing_pass_3: "analyzing_pass_3",
  analyzing_pass_4: "analyzing_pass_4",
  compiling_insights: "compiling_insights",
  completed: "completed",
  failed: "failed",
} as const;

export type TranscriptStatus = (typeof TranscriptStatus)[keyof typeof TranscriptStatus];

export const InsightType = {
  pain: "pain",
  blocker: "blocker",
  feature_request: "feature_request",
  idea: "idea",
  gain: "gain",
  outcome: "outcome",
  objection: "objection",
  buying_signal: "buying_signal",
  question: "question",
  feedback: "feedback",
  confusion: "confusion",
  opportunity: "opportunity",
  insight: "insight",
  other: "other",
} as const;

export type InsightType = (typeof InsightType)[keyof typeof InsightType];

export const InsightStatus = {
  generated: "generated",
  exported: "exported",
  archived: "archived",
  failed: "failed",
} as const;

export type InsightStatus = (typeof InsightStatus)[keyof typeof InsightStatus];
