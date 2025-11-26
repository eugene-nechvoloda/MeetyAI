/**
 * Slack App Home Views
 * 
 * Builds the 3-tab App Home interface:
 * - Home: Welcome and quick stats
 * - Transcripts: Upload and transcript list
 * - Insights: Insight list with export functionality
 */

import { getPrismaAsync } from "../utils/database";

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
    const prisma = await getPrismaAsync();
    
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
            action_id: "open_upload_transcript_modal",
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
          action_id: "open_upload_transcript_modal",
          style: "primary",
        },
      ],
    },
    {
      type: "divider",
    },
  ];
  
  try {
    const prisma = await getPrismaAsync();
    
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
          action_id: "open_export_settings",
        },
      ],
    },
    {
      type: "divider",
    },
  ];
  
  try {
    const prisma = await getPrismaAsync();
    
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

/**
 * Build the upload transcript modal with both text paste and file upload options
 */
export function buildUploadTranscriptModal() {
  return {
    type: "modal",
    callback_id: "upload_transcript_modal",
    title: {
      type: "plain_text",
      text: "Upload Transcript",
    },
    submit: {
      type: "plain_text",
      text: "Analyze",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "input",
        block_id: "title_input",
        label: {
          type: "plain_text",
          text: "Transcript Title",
        },
        element: {
          type: "plain_text_input",
          action_id: "title_text",
          placeholder: {
            type: "plain_text",
            text: "e.g., Sales Call with ACME Corp",
          },
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Choose how to add your transcript:*\nYou can either paste the text directly OR upload a file",
        },
      },
      {
        type: "input",
        block_id: "file_input",
        optional: true,
        label: {
          type: "plain_text",
          text: "Upload File",
        },
        element: {
          type: "file_input",
          action_id: "transcript_file",
          max_files: 1,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "_Supports text files, transcripts, and documents_",
          },
        ],
      },
      {
        type: "divider",
      },
      {
        type: "input",
        block_id: "transcript_input",
        optional: true,
        label: {
          type: "plain_text",
          text: "Or Paste Transcript Text",
        },
        element: {
          type: "plain_text_input",
          action_id: "transcript_text",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Paste your transcript here...",
          },
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "💡 MeetyAI will analyze your transcript and extract insights automatically.",
          },
        ],
      },
    ],
  };
}

/**
 * Build the export settings modal with 14 insight types as checkboxes
 */
export async function buildExportSettingsModal(userId: string) {
  const insightTypes = [
    { value: "pain", label: "😣 Pain Points", description: "Problems and frustrations" },
    { value: "blocker", label: "🚫 Blockers", description: "Obstacles preventing progress" },
    { value: "feature_request", label: "✨ Feature Requests", description: "Desired capabilities" },
    { value: "idea", label: "💭 Ideas", description: "Creative suggestions" },
    { value: "gain", label: "📈 Gains", description: "Positive outcomes and benefits" },
    { value: "outcome", label: "🎯 Outcomes", description: "Desired results" },
    { value: "objection", label: "⚠️ Objections", description: "Concerns and hesitations" },
    { value: "buying_signal", label: "💰 Buying Signals", description: "Purchase intent indicators" },
    { value: "question", label: "❓ Questions", description: "Unanswered queries" },
    { value: "feedback", label: "💬 Feedback", description: "General input and reactions" },
    { value: "confusion", label: "😵 Confusion", description: "Unclear or misunderstood topics" },
    { value: "opportunity", label: "🚀 Opportunities", description: "Potential growth areas" },
    { value: "sentiment", label: "❤️ Sentiment", description: "Emotional tone and attitude" },
    { value: "insight", label: "💡 General Insights", description: "Other valuable observations" },
  ];
  
  const checkboxOptions = insightTypes.map(type => ({
    text: {
      type: "plain_text" as const,
      text: type.label,
    },
    description: {
      type: "plain_text" as const,
      text: type.description,
    },
    value: type.value,
  }));
  
  return {
    type: "modal",
    callback_id: "export_settings_modal",
    title: {
      type: "plain_text",
      text: "Export Settings",
    },
    submit: {
      type: "plain_text",
      text: "Save Settings",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Select insight types to include in exports:*",
        },
      },
      {
        type: "input",
        block_id: "insight_types_selection",
        label: {
          type: "plain_text",
          text: "Insight Types",
        },
        element: {
          type: "checkboxes",
          action_id: "selected_insight_types",
          options: checkboxOptions,
          initial_options: checkboxOptions, // All selected by default
        },
      },
      {
        type: "divider",
      },
      {
        type: "input",
        block_id: "confidence_threshold",
        label: {
          type: "plain_text",
          text: "Minimum Confidence (%)",
        },
        element: {
          type: "plain_text_input",
          action_id: "confidence_value",
          initial_value: "50",
          placeholder: {
            type: "plain_text",
            text: "50",
          },
        },
        hint: {
          type: "plain_text",
          text: "Only export insights above this confidence threshold",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "⚙️ These settings apply to all future exports.",
          },
        ],
      },
    ],
  };
}
