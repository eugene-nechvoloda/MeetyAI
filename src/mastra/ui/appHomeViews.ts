/**
 * Slack App Home Views
 * 
 * Builds the 3-tab App Home interface:
 * - Home: Welcome and quick stats
 * - Transcripts: Upload and transcript list
 * - Insights: Insight list with export functionality
 */

import { getPrisma } from "../utils/database";

// Tab types for navigation
type TabType = "home" | "transcripts" | "insights";

/**
 * Build the tab navigation bar that appears at the top of every view
 */
function buildTabNavigation(activeTab: TabType): any[] {
  return [
    {
      type: "actions",
      block_id: "tab_navigation",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: activeTab === "home" ? "🏠 Home ●" : "🏠 Home",
          },
          action_id: "switch_to_home_tab",
          style: activeTab === "home" ? "primary" : undefined,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: activeTab === "transcripts" ? "📝 Transcripts ●" : "📝 Transcripts",
          },
          action_id: "switch_to_transcripts_tab",
          style: activeTab === "transcripts" ? "primary" : undefined,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: activeTab === "insights" ? "💡 Insights ●" : "💡 Insights",
          },
          action_id: "switch_to_insights_tab",
          style: activeTab === "insights" ? "primary" : undefined,
        },
      ],
    },
    {
      type: "divider",
    },
  ];
}

export async function buildHomeTab(userId: string) {
  let transcriptCount = 0;
  let insightCount = 0;
  let newInsightCount = 0;
  let statsAvailable = true;
  
  try {
    const prisma = getPrisma();
    
    // Get quick stats
    transcriptCount = await prisma.transcript.count({
      where: { slack_user_id: userId },
    });
    
    insightCount = await prisma.insight.count({
      where: { 
        transcript: {
          slack_user_id: userId,
        },
      },
    });
    
    newInsightCount = await prisma.insight.count({
      where: { 
        transcript: {
          slack_user_id: userId,
        },
        exported: false,
      },
    });
  } catch (error) {
    console.error("Database error in buildHomeTab:", error);
    statsAvailable = false;
  }
  
  const statsText = statsAvailable
    ? `📊 *Your Stats*\n• ${transcriptCount} transcripts analyzed\n• ${insightCount} insights extracted\n• ${newInsightCount} insights ready to export`
    : "📊 *Your Stats*\n_Loading..._";
  
  return {
    type: "home",
    blocks: [
      // Tab navigation at the top
      ...buildTabNavigation("home"),
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
          text: statsText,
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
              text: "⚙️ Settings",
            },
            action_id: "open_export_settings",
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "💡 *Tip:* Use the tabs above to navigate between Home, Transcripts, and Insights",
          },
        ],
      },
    ],
  };
}

export async function buildTranscriptsTab(userId: string) {
  const blocks: any[] = [
    // Tab navigation at the top
    ...buildTabNavigation("transcripts"),
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
  
  try {
    const prisma = getPrisma();
    
    // Get transcripts for this user
    const transcripts = await prisma.transcript.findMany({
      where: { slack_user_id: userId },
      orderBy: { created_at: "desc" },
      take: 10, // Show last 10
    });
    
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
        let insightCount = 0;
        try {
          insightCount = await prisma.insight.count({
            where: { transcript_id: transcript.id },
          });
        } catch (e) {
          // Ignore count error
        }
        
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
  } catch (error) {
    console.error("Database error in buildTranscriptsTab:", error);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_Loading transcripts..._",
      },
    });
  }
  
  return {
    type: "home",
    blocks,
  };
}

export async function buildInsightsTab(userId: string) {
  const blocks: any[] = [
    // Tab navigation at the top
    ...buildTabNavigation("insights"),
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
  
  try {
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
          question: "❓",
          feedback: "💬",
          confusion: "😵",
          opportunity: "🚀",
          insight: "💡",
        };
        const emoji = typeEmoji[insight.type] || "📝";
        
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
  } catch (error) {
    console.error("Database error in buildInsightsTab:", error);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_Loading insights..._",
      },
    });
  }
  
  return {
    type: "home",
    blocks,
  };
}
