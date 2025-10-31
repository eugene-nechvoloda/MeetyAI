/**
 * Slack App Home Views
 * 
 * Builds the 3-tab App Home interface:
 * - Home: Welcome and quick stats
 * - Transcripts: Upload and transcript list
 * - Insights: Insight list with export functionality
 */

import { getPrisma } from "../utils/database";

export async function buildHomeTab(userId: string) {
  const prisma = getPrisma();
  
  // Get quick stats
  const transcriptCount = await prisma.transcript.count({
    where: { slack_user_id: userId },
  });
  
  const insightCount = await prisma.insight.count({
    where: { 
      transcript: {
        slack_user_id: userId,
      },
    },
  });
  
  const newInsightCount = await prisma.insight.count({
    where: { 
      transcript: {
        slack_user_id: userId,
      },
      exported: false,
    },
  });
  
  return {
    type: "home",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Welcome to MeetyAI* 🎯\n\nYour AI-powered transcript analysis assistant",
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📊 *Your Stats*\n• ${transcriptCount} transcripts analyzed\n• ${insightCount} insights extracted\n• ${newInsightCount} insights ready to export`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Quick Actions*",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "📤 Upload Transcript",
            },
            action_id: "open_upload_modal",
            style: "primary",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "💡 View Insights",
            },
            action_id: "switch_to_insights_tab",
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "💡 *Tip:* Use the tabs above to navigate between Transcripts and Insights",
          },
        ],
      },
    ],
  };
}

export async function buildTranscriptsTab(userId: string) {
  const prisma = getPrisma();
  
  // Get transcripts for this user
  const transcripts = await prisma.transcript.findMany({
    where: { slack_user_id: userId },
    orderBy: { created_at: "desc" },
    take: 10, // Show last 10
  });
  
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Your Transcripts* 📝",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "➕ Upload New Transcript",
          },
          action_id: "open_upload_modal",
          style: "primary",
        },
      ],
    },
    {
      type: "divider",
    },
  ];
  
  if (transcripts.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No transcripts yet. Click *Upload New Transcript* to get started!",
      },
    });
  } else {
    for (const transcript of transcripts) {
      const date = new Date(transcript.created_at).toLocaleDateString();
      
      // Count insights for this transcript
      const insightCount = await prisma.insight.count({
        where: { transcript_id: transcript.id },
      });
      
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${transcript.title}*\n📅 ${date} • 💡 ${insightCount} insights`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Insights",
          },
          action_id: "view_transcript_insights",
          value: transcript.id,
        },
      });
      
      blocks.push({
        type: "divider",
      });
    }
  }
  
  return {
    type: "home",
    blocks,
  };
}

export async function buildInsightsTab(userId: string) {
  const prisma = getPrisma();
  
  // Get insights for this user
  const insights = await prisma.insight.findMany({
    where: { 
      transcript: {
        slack_user_id: userId,
      },
    },
    orderBy: { created_at: "desc" },
    take: 20, // Show last 20
    include: {
      transcript: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });
  
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Your Insights* 💡",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "📤 Export to Linear",
          },
          action_id: "export_all_linear",
          style: "primary",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "📤 Export to Airtable",
          },
          action_id: "export_all_airtable",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "⚙️ Export Settings",
          },
          action_id: "open_insights_export_settings",
        },
      ],
    },
    {
      type: "divider",
    },
  ];
  
  if (insights.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No insights yet. Upload a transcript to extract insights!",
      },
    });
  } else {
    for (const insight of insights) {
      const statusBadge = insight.exported ? "✅ Exported" : "🆕 New";
      const typeEmoji: Record<string, string> = {
        pain: "😣",
        blocker: "🚫",
        feature_request: "✨",
        idea: "💭",
        gain: "📈",
        outcome: "🎯",
        objection: "⚠️",
        buying_signal: "💰",
      };
      const emoji = typeEmoji[insight.type] || "💡";
      
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${insight.title}*\n${insight.description}\n\n_${statusBadge} • Confidence: ${(insight.confidence * 100).toFixed(0)}% • Source: ${insight.transcript.title}_`,
        },
        accessory: insight.exported ? undefined : {
          type: "button",
          text: {
            type: "plain_text",
            text: "Export",
          },
          action_id: "export_single_insight",
          value: insight.id,
        },
      });
      
      blocks.push({
        type: "divider",
      });
    }
  }
  
  return {
    type: "home",
    blocks,
  };
}
