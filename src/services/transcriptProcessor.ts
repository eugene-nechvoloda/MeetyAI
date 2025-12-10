/**
 * Transcript Processor - Direct Anthropic API
 *
 * Replaces Mastra workflows with simple async processing
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger, prisma, slack } from '../index.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are MeetyAI, an AI assistant specialized in analyzing meeting transcripts and extracting actionable insights.

Your task is to analyze the provided transcript and extract key insights.

Valid insight types:
- pain_point: User pain points or problems explicitly mentioned
- hidden_complaint: Subtle complaints or frustrations not directly stated
- explicit_complaint: Direct complaints or negative feedback
- feature_request: Requested features or capabilities
- idea: New ideas or suggestions
- opportunity: Potential opportunities or positive directions
- blocker: Obstacles preventing progress
- question: Important questions raised
- feedback: General feedback or opinions
- other: Anything else noteworthy

Format your response as JSON:
{
  "summary": "Brief meeting summary",
  "insights": [
    {
      "type": "pain_point" | "hidden_complaint" | "explicit_complaint" | "feature_request" | "idea" | "opportunity" | "blocker" | "question" | "feedback" | "other",
      "title": "Short title (max 100 chars)",
      "description": "Detailed description",
      "owner": "Person responsible (if mentioned, otherwise null)"
    }
  ]
}`;

export async function processTranscript(transcriptId: string): Promise<void> {
  console.log(`[DEBUG] processTranscript CALLED for ID: ${transcriptId}`);
  logger.info(`🚀 Processing transcript ${transcriptId}`);

  try {
    console.log(`[DEBUG] Updating status to 'processing' for ${transcriptId}`);
    // Update status to processing
    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { status: 'processing' },
    });
    console.log(`[DEBUG] Status updated to 'processing' successfully`);

    // Get transcript
    const transcript = await prisma.transcript.findUnique({
      where: { id: transcriptId },
    });

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }

    logger.info(`📝 Analyzing transcript: ${transcript.title}`);

    // Call Anthropic API
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Analyze this transcript and extract insights:\n\n${transcript.transcript_text}`,
        },
      ],
    });

    // Parse response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response format');
    }

    const result = JSON.parse(content.text);

    logger.info(`✅ Analysis complete, found ${result.insights.length} insights`);

    // Save insights
    for (const insight of result.insights) {
      await prisma.insight.create({
        data: {
          transcript_id: transcriptId,
          type: insight.type,
          title: insight.title,
          description: insight.description,
          owner: insight.owner || null,
          status: 'new',
          evidence_quotes: [],
          confidence: 0.8,
        },
      });
    }

    // Mark as processed
    await prisma.transcript.update({
      where: { id: transcriptId },
      data: {
        status: 'processed',
        processed_at: new Date(),
      },
    });

    logger.info(`✅ Transcript ${transcriptId} processing complete`);

    // Send Slack notification
    if (transcript.slack_user_id) {
      await slack.client.chat.postMessage({
        channel: transcript.slack_user_id,
        text: `✅ Analysis complete for "${transcript.title}"!\n\nFound ${result.insights.length} insights:\n${result.summary}`,
      });
    }

    // Refresh App Home
    if (transcript.slack_user_id) {
      const { buildHomeTab } = await import('../slack/views/appHome.js');
      const view = await buildHomeTab(transcript.slack_user_id);
      await slack.client.views.publish({
        user_id: transcript.slack_user_id,
        view,
      });
    }

  } catch (error) {
    logger.error(`❌ Failed to process transcript ${transcriptId}:`, error);

    // Mark as failed
    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { status: 'failed' },
    });

    throw error;
  }
}
