/**
 * Slack App Home View Builder - Simplified
 */

import { prisma, logger } from '../../index.js';

export async function buildHomeTab(userId: string) {
  try {
    // Get transcripts for this user
    const transcripts = await prisma.transcript.findMany({
      where: {
        slack_user_id: userId,
        archived: false,
      },
      orderBy: { created_at: 'desc' },
      take: 10,
      include: {
        _count: {
          select: { insights: true },
        },
      },
    });

    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📊 MeetyAI - Transcript Analysis',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_Upload and analyze your meeting transcripts_',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '➕ Upload New Transcript',
              emoji: true,
            },
            style: 'primary',
            action_id: 'upload_transcript_button',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '💬 Start Chat',
              emoji: true,
            },
            action_id: 'start_chat_button',
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📝 Recent Transcripts',
          emoji: true,
        },
      },
    ];

    if (transcripts.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_No transcripts yet. Upload your first meeting transcript to get started!_',
        },
      });
    } else {
      for (const transcript of transcripts) {
        const statusEmoji = getStatusEmoji(transcript.status);
        const statusText = getStatusText(transcript.status);
        const insightCount = transcript._count.insights;

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${transcript.title}*\n${statusEmoji} ${statusText} • ${insightCount} insights\n_Uploaded: ${new Date(transcript.created_at).toLocaleDateString()}_`,
          },
          accessory: {
            type: 'overflow',
            options: [
              {
                text: {
                  type: 'plain_text',
                  text: '🔄 Re-analyze',
                },
                value: transcript.id,
              },
              {
                text: {
                  type: 'plain_text',
                  text: '🗑️ Archive',
                },
                value: transcript.id,
              },
            ],
            action_id: `transcript_menu_${transcript.id}`,
          },
        });
      }
    }

    return {
      type: 'home',
      blocks,
    };
  } catch (error) {
    logger.error('Error building app home:', error);

    return {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '❌ Error loading app home. Please try again.',
          },
        },
      ],
    };
  }
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'file_uploaded':
      return '⏳';
    case 'analyzing_pass_1':
    case 'analyzing_pass_2':
    case 'analyzing_pass_3':
    case 'analyzing_pass_4':
      return '🔄';
    case 'compiling_insights':
      return '📊';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    default:
      return '⏳';
  }
}

function getStatusText(status: string): string {
  switch (status) {
    case 'file_uploaded':
      return 'Pending';
    case 'analyzing_pass_1':
      return 'Analyzing';
    case 'compiling_insights':
      return 'Compiling';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}
