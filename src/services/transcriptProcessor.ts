/**
 * Dual-AI Transcript Processor
 *
 * Stage 1: Claude Sonnet 4.5 - Analysis (extracts raw insights)
 * Stage 2: GPT-5 - Writing (crafts polished titles and descriptions)
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { TranscriptStatus } from '@prisma/client';
import { logger, prisma, slack } from '../index.js';
import crypto from 'crypto';

// Initialize AI clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Hardcoded for MVP
const RESEARCH_DEPTH = 0.7;
const TEMPERATURE = 0.35;
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const GPT_MODEL = 'gpt-5-preview';

/**
 * Main processing function
 */
export async function processTranscript(transcriptId: string): Promise<void> {
  logger.info(`🚀 Processing transcript ${transcriptId}`);

  try {
    // Get transcript
    const transcript = await prisma.transcript.findUnique({
      where: { id: transcriptId },
    });

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    // Get user settings for custom context and examples
    const userSettings = await prisma.userSetting.findUnique({
      where: { user_id: transcript.slack_user_id },
    });

    logger.info(`📝 Analyzing transcript: ${transcript.title}`);

    // Step 1: Context Classification
    await updateStatus(transcriptId, TranscriptStatus.analyzing_pass_1);
    const context = await classifyContext(transcript.transcript_text || '');

    await prisma.transcript.update({
      where: { id: transcriptId },
      data: {
        context_theme: context.context,
        context_confidence: context.confidence,
      },
    });

    // Step 2-5: 4-Pass Analysis with Claude
    const rawInsights = await extractRawInsights(
      transcript.transcript_text || '',
      userSettings?.custom_context || '',
      transcriptId
    );

    logger.info(`✅ Analysis complete, found ${rawInsights.length} raw insights`);

    // Step 6: Writing Pass with GPT-5
    await updateStatus(transcriptId, TranscriptStatus.compiling_insights);
    const refinedInsights = await refineInsights(
      rawInsights,
      userSettings?.custom_context || '',
      userSettings?.insight_examples || ''
    );

    logger.info(`✅ Writing complete, refined ${refinedInsights.length} insights`);

    // Step 7: Deduplication
    const deduplicatedInsights = await deduplicateInsights(refinedInsights);

    // Step 8: Save to database
    for (const insight of deduplicatedInsights) {
      await prisma.insight.create({
        data: {
          transcript_id: transcriptId,
          type: insight.type,
          title: insight.title,
          description: insight.description,
          author: insight.speaker,
          evidence_text: insight.evidence,
          evidence_quotes: [{ quote: insight.evidence, speaker: insight.speaker, timestamp: insight.timestamp }],
          confidence: insight.confidence,
          speaker: insight.speaker,
          timestamp_start: insight.timestamp,
          content_hash: hashContent(insight.title + insight.description),
          status: 'new',
        },
      });
    }

    // Mark as completed
    await updateStatus(transcriptId, TranscriptStatus.completed);
    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { processed_at: new Date() },
    });

    logger.info(`✅ Transcript ${transcriptId} processing complete`);

    // Send Slack notification
    await sendCompletionNotification(transcript, deduplicatedInsights.length);

    // Refresh App Home
    await refreshAppHome(transcript.slack_user_id);

  } catch (error) {
    logger.error(`❌ Failed to process transcript ${transcriptId}:`, error);

    // Mark as failed
    await updateStatus(transcriptId, TranscriptStatus.failed);

    // Log activity
    await prisma.transcriptActivity.create({
      data: {
        transcript_id: transcriptId,
        activity_type: 'processing_failed',
        message: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {},
      },
    });

    throw error;
  }
}

/**
 * Step 1: Classify transcript context
 */
async function classifyContext(text: string): Promise<{ context: string; confidence: number }> {
  const prompt = `Classify this meeting transcript into one of the following categories:
- research_call
- feedback_session
- usability_testing
- sales_demo
- support_call
- general_interview
- internal_meeting
- customer_onboarding
- strategy_session
- other

Return JSON only:
{
  "context": "category_name",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    temperature: 0.3,
    messages: [
      { role: 'user', content: `${prompt}\n\nTranscript:\n${text.substring(0, 2000)}` },
    ],
  });

  const content = response.content[0];
  if (content.type === 'text') {
    const result = JSON.parse(content.text);
    return { context: result.context, confidence: result.confidence };
  }

  return { context: 'other', confidence: 0.5 };
}

/**
 * Steps 2-5: Extract raw insights with Claude (4 passes)
 */
async function extractRawInsights(
  text: string,
  customContext: string,
  transcriptId: string
): Promise<any[]> {
  const allInsights: any[] = [];

  const passes = [
    { pass: 1, types: ['pain', 'blocker', 'opportunity'], status: TranscriptStatus.analyzing_pass_1 },
    { pass: 2, types: ['feature_request', 'idea', 'outcome'], status: TranscriptStatus.analyzing_pass_2 },
    { pass: 3, types: ['question', 'feedback', 'confusion'], status: TranscriptStatus.analyzing_pass_3 },
    { pass: 4, types: ['gain', 'buying_signal', 'objection', 'insight'], status: TranscriptStatus.analyzing_pass_4 },
  ];

  for (const passInfo of passes) {
    await updateStatus(transcriptId, passInfo.status);
    logger.info(`🔄 Running analysis pass ${passInfo.pass}`);

    const systemPrompt = `You are MeetyAI Analysis Engine. Your task is to analyze meeting transcripts and identify insights.

${customContext ? `CUSTOM CONTEXT:\n${customContext}\n\n` : ''}

Extract the following types of insights: ${passInfo.types.join(', ')}.

For each insight, extract:
- Type (one of: ${passInfo.types.join(', ')})
- Raw content (what was said)
- Evidence (direct quote from transcript)
- Speaker (who said it)
- Timestamp (if available in format HH:MM:SS)
- Context (surrounding conversation)
- Confidence (0.0 to 1.0)

Format your response as JSON only:
{
  "raw_insights": [
    {
      "type": "pain",
      "raw_content": "User expressed frustration...",
      "evidence": "Direct quote from transcript",
      "speaker": "Speaker name",
      "timestamp": "00:15:23",
      "context": "Surrounding conversation",
      "confidence": 0.85
    }
  ]
}

Extract approximately ${Math.floor(RESEARCH_DEPTH * 10)} insights per hour of conversation.
Be thorough but avoid duplicates.
Focus on actionable insights.`;

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      temperature: TEMPERATURE,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `Analyze this transcript:\n\n${text}` },
      ],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      try {
        const result = JSON.parse(content.text);
        allInsights.push(...result.raw_insights);
        logger.info(`✅ Pass ${passInfo.pass} extracted ${result.raw_insights.length} insights`);
      } catch (e) {
        logger.error(`❌ Failed to parse pass ${passInfo.pass} response:`, e);
      }
    }
  }

  return allInsights;
}

/**
 * Step 6: Refine insights with GPT-5
 */
async function refineInsights(
  rawInsights: any[],
  customContext: string,
  insightExamples: string
): Promise<any[]> {
  logger.info(`✍️ Refining ${rawInsights.length} insights with GPT-5`);

  const systemPrompt = `You are MeetyAI Writing Engine. Your task is to write clear, actionable insight titles and descriptions.

${customContext ? `CUSTOM CONTEXT:\n${customContext}\n\n` : ''}
${insightExamples ? `EXAMPLES:\n${insightExamples}\n\n` : ''}

For each raw insight, write:
1. **Title**: Clear, concise (max 10 words), action-oriented
2. **Description**: Detailed but scannable (2-3 sentences), includes what it is, why it matters, and suggested next steps

Writing guidelines:
- Use active voice
- Be specific and concrete
- Avoid jargon unless necessary
- Match the tone from examples
- Ensure consistency

Return JSON only:
{
  "insights": [
    {
      "title": "Login process causes user frustration",
      "description": "Users are experiencing significant delays...",
      "type": "pain",
      "evidence": "original evidence",
      "speaker": "original speaker",
      "timestamp": "original timestamp",
      "confidence": 0.85
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Refine these raw insights:\n\n${JSON.stringify(rawInsights, null, 2)}` },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  });

  const content = response.choices[0].message.content;
  if (content) {
    try {
      const result = JSON.parse(content);
      return result.insights;
    } catch (e) {
      logger.error('❌ Failed to parse GPT-5 response:', e);
      return rawInsights; // Fallback to raw insights
    }
  }

  return rawInsights;
}

/**
 * Step 7: Deduplicate insights
 */
async function deduplicateInsights(insights: any[]): Promise<any[]> {
  const unique = new Map<string, any>();

  for (const insight of insights) {
    const hash = hashContent(insight.title + insight.description);
    if (!unique.has(hash)) {
      unique.set(hash, insight);
    }
  }

  logger.info(`📊 Deduplication: ${insights.length} → ${unique.size} unique insights`);
  return Array.from(unique.values());
}

/**
 * Utility: Update transcript status
 */
async function updateStatus(transcriptId: string, status: TranscriptStatus): Promise<void> {
  await prisma.transcript.update({
    where: { id: transcriptId },
    data: { status },
  });

  await prisma.transcriptActivity.create({
    data: {
      transcript_id: transcriptId,
      activity_type: 'status_change',
      message: `Status updated to: ${status}`,
      metadata: {},
    },
  });
}

/**
 * Utility: Hash content for deduplication
 */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Utility: Send completion notification
 */
async function sendCompletionNotification(transcript: any, insightCount: number): Promise<void> {
  try {
    await slack.client.chat.postMessage({
      channel: transcript.slack_user_id,
      text: `✅ Analysis complete for "${transcript.title}"!\n\nExtracted ${insightCount} insights using dual-AI processing.`,
    });
  } catch (error) {
    logger.error('Failed to send completion notification:', error);
  }
}

/**
 * Utility: Refresh App Home
 */
async function refreshAppHome(userId: string): Promise<void> {
  try {
    const { buildHomeTab } = await import('../slack/views/appHome.js');
    const view = await buildHomeTab(userId);
    await slack.client.views.publish({
      user_id: userId,
      view,
    });
  } catch (error) {
    logger.error('Failed to refresh App Home:', error);
  }
}
