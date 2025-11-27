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
    
    // Get quick stats (excluding archived)
    transcriptCount = await prisma.transcript.count({
      where: { 
        slack_user_id: userId,
        archived: false,
      },
    });
    
    insightCount = await prisma.insight.count({
      where: { 
        transcript: {
          slack_user_id: userId,
          archived: false,
        },
        archived: false,
      },
    });
    
    newInsightCount = await prisma.insight.count({
      where: { 
        transcript: {
          slack_user_id: userId,
          archived: false,
        },
        archived: false,
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
    
    // Get transcripts for this user (excluding archived)
    const transcripts = await prisma.transcript.findMany({
      where: { 
        slack_user_id: userId,
        archived: false,
      },
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
        
        // Count insights for this transcript (excluding archived)
        let insightCount = 0;
        try {
          insightCount = await prisma.insight.count({
            where: { 
              transcript_id: transcript.id,
              archived: false,
            },
          });
        } catch (e) {
          // Ignore count error
        }
        
        // Determine status indicator based on transcript.status
        const status = transcript.status;
        let statusIndicator = "";
        let isProcessing = false;
        
        if (status === "completed") {
          statusIndicator = "✅ Processed";
        } else if (status === "failed") {
          statusIndicator = "❌ Failed";
        } else if (status === "file_uploaded") {
          // Just uploaded, workflow may not have started yet
          statusIndicator = "⏳ Pending...";
          isProcessing = true;
        } else if (status === "transcribing") {
          statusIndicator = "🎙️ Transcribing...";
          isProcessing = true;
        } else if (status === "translating") {
          statusIndicator = "🌐 Translating...";
          isProcessing = true;
        } else if (status === "analyzing_pass_1") {
          statusIndicator = "🔍 Analyzing (1/4)...";
          isProcessing = true;
        } else if (status === "analyzing_pass_2") {
          statusIndicator = "🔍 Analyzing (2/4)...";
          isProcessing = true;
        } else if (status === "analyzing_pass_3") {
          statusIndicator = "🔍 Analyzing (3/4)...";
          isProcessing = true;
        } else if (status === "analyzing_pass_4") {
          statusIndicator = "🔍 Analyzing (4/4)...";
          isProcessing = true;
        } else if (status === "compiling_insights") {
          statusIndicator = "📋 Compiling insights...";
          isProcessing = true;
        } else {
          // Any other status - show as processing
          statusIndicator = "⏳ Processing...";
          isProcessing = true;
        }
        
        // Build status line - show insights count only if completed or has insights
        let infoLine = `📅 ${date}`;
        if (status === "completed" || insightCount > 0) {
          infoLine += ` • 💡 ${insightCount} insights`;
          if (insightCount === 0) {
            infoLine += " ⚠️";
          }
        }
        infoLine += ` • ${statusIndicator}`;
        
        // Transcript info section
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${transcript.title}*\n${infoLine}`,
          },
        });
        
        // Action buttons for this transcript
        const actionButtons: any[] = [];
        
        // Don't show action buttons while processing (except archive)
        if (isProcessing) {
          // Show disabled-looking context for processing state
          blocks.push({
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "_Analysis in progress. This may take 1-2 minutes..._",
              },
            ],
          });
        } else if (insightCount === 0) {
          actionButtons.push({
            type: "button",
            text: {
              type: "plain_text",
              text: "🔄 Re-analyze",
            },
            action_id: "reanalyze_transcript",
            value: transcript.id,
            style: "primary",
          });
        } else {
          actionButtons.push({
            type: "button",
            text: {
              type: "plain_text",
              text: "View Insights",
            },
            action_id: "view_transcript_insights",
            value: transcript.id,
          });
        }
        
        // Archive button - always add unless processing
        if (!isProcessing) {
          actionButtons.push({
            type: "button",
            text: {
              type: "plain_text",
              text: "🗑️ Archive",
            },
            action_id: "archive_transcript",
            value: transcript.id,
            confirm: {
              title: {
                type: "plain_text",
                text: "Archive Transcript",
              },
              text: {
                type: "mrkdwn",
                text: `Are you sure you want to archive "*${transcript.title}*"?\n\nThis will hide the transcript and its insights from your lists. You can contact support to restore it if needed.`,
              },
              confirm: {
                type: "plain_text",
                text: "Archive",
              },
              deny: {
                type: "plain_text",
                text: "Cancel",
              },
            },
          });
        }
        
        // Only add actions block if we have buttons
        if (actionButtons.length > 0) {
          blocks.push({
            type: "actions",
            elements: actionButtons,
          });
        }
        
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
    
    // Get insights for this user (excluding archived)
    const insights = await prisma.insight.findMany({
      where: { 
        transcript: {
          slack_user_id: userId,
          archived: false,
        },
        archived: false,
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
    
    // Count insights by status for summary
    const newCount = insights.filter((i: { status: string }) => i.status === "new").length;
    const exportedCount = insights.filter((i: { status: string }) => i.status === "exported").length;
    const failedCount = insights.filter((i: { status: string }) => i.status === "export_failed").length;
    
    // Add summary stats
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📊 *${insights.length} insights* | 🆕 ${newCount} New | ✅ ${exportedCount} Exported${failedCount > 0 ? ` | ❌ ${failedCount} Failed` : ""}`,
        },
      ],
    });
    
    blocks.push({ type: "divider" });
    
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
        // Status badge based on new status enum
        let statusBadge = "🆕 New";
        if (insight.status === "exported") {
          statusBadge = "✅ Exported";
        } else if (insight.status === "export_failed") {
          statusBadge = "❌ Failed";
        } else if (insight.status === "archived") {
          statusBadge = "📦 Archived";
        }
        
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
        
        // Build the main text with author if available
        let mainText = `${emoji} *${insight.title}*\n${insight.description}`;
        if (insight.author) {
          mainText += `\n👤 _${insight.author}_`;
        }
        mainText += `\n\n${statusBadge} • Confidence: ${(insight.confidence * 100).toFixed(0)}% • Source: ${insight.transcript.title}`;
        
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: mainText,
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
 * Build the main Settings hub modal
 */
export async function buildExportSettingsModal(userId: string) {
  const prisma = await getPrismaAsync();
  
  // Get existing export configurations
  const exportConfigs = await prisma.exportConfig.findMany({
    where: { user_id: userId },
  });
  
  // Get user settings
  const userSettings = await prisma.userSetting.findUnique({
    where: { user_id: userId },
  });
  
  // Check which providers are configured
  const linearConfig = exportConfigs.find((c: { provider: string }) => c.provider === "linear");
  const airtableConfig = exportConfigs.find((c: { provider: string }) => c.provider === "airtable");
  
  // Check Zoom config from ImportSource table
  const zoomConfig = await prisma.importSource.findFirst({
    where: { user_id: userId, provider: "zoom" },
  });
  
  // Generate webhook URL for this user
  const baseUrl = process.env.REPLIT_DEV_DOMAIN 
    ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
    : "https://your-app-url.replit.app";
  const webhookUrl = `${baseUrl}/api/webhooks/transcript?userId=${userId}`;
  
  return {
    type: "modal",
    callback_id: "settings_hub_modal",
    title: {
      type: "plain_text",
      text: "Settings",
    },
    close: {
      type: "plain_text",
      text: "Close",
    },
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Export Destinations",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Linear* ${linearConfig?.enabled ? "✅ Connected" : "⚪ Not configured"}\nExport insights as Linear issues`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: linearConfig ? "Edit" : "Configure",
          },
          action_id: "configure_linear",
        },
      },
      ...(linearConfig?.enabled ? [{
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "📋 Edit Field Mapping" },
            action_id: `edit_mapping_${linearConfig.id}`,
            value: linearConfig.id,
          },
        ],
      }] : []),
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Airtable* ${airtableConfig?.enabled ? "✅ Connected" : "⚪ Not configured"}\nExport insights to Airtable base`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: airtableConfig ? "Edit" : "Configure",
          },
          action_id: "configure_airtable",
        },
      },
      ...(airtableConfig?.enabled ? [{
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "📋 Edit Field Mapping" },
            action_id: `edit_mapping_${airtableConfig.id}`,
            value: airtableConfig.id,
          },
        ],
      }] : []),
      {
        type: "divider",
      },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Import Sources",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Zoom API* ${zoomConfig?.enabled ? "✅ Connected" : "⚪ Not configured"}\nAutomatically import meeting transcripts (hourly)`,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: zoomConfig ? "Edit" : "Configure",
          },
          action_id: "configure_zoom",
        },
      },
      {
        type: "divider",
      },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Webhook URL",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Use this URL to send transcripts from external tools (n8n, Zapier, etc.):",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `\`${webhookUrl}\``,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "POST JSON with: `{ \"title\": \"...\", \"content\": \"...\" }`",
          },
        ],
      },
    ],
  };
}

/**
 * Build Linear configuration modal
 */
export function buildLinearConfigModal(existingConfig?: any) {
  return {
    type: "modal",
    callback_id: "linear_config_modal",
    title: {
      type: "plain_text",
      text: "Configure Linear",
    },
    submit: {
      type: "plain_text",
      text: "Save",
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
          text: "Connect your Linear workspace to export insights as issues.",
        },
      },
      {
        type: "input",
        block_id: "linear_api_key",
        label: {
          type: "plain_text",
          text: "Linear API Key",
        },
        element: {
          type: "plain_text_input",
          action_id: "api_key_input",
          placeholder: {
            type: "plain_text",
            text: "lin_api_xxxxxxxxxxxx",
          },
        },
        hint: {
          type: "plain_text",
          text: "Get your API key from Linear Settings > API",
        },
      },
      {
        type: "input",
        block_id: "linear_team_id",
        label: {
          type: "plain_text",
          text: "Team ID",
        },
        element: {
          type: "plain_text_input",
          action_id: "team_id_input",
          placeholder: {
            type: "plain_text",
            text: "e.g., TEAM-123 or team UUID",
          },
        },
        hint: {
          type: "plain_text",
          text: "The team where issues will be created",
        },
      },
      {
        type: "input",
        block_id: "linear_label",
        optional: true,
        label: {
          type: "plain_text",
          text: "Connection Label",
        },
        element: {
          type: "plain_text_input",
          action_id: "label_input",
          initial_value: existingConfig?.label || "My Linear Workspace",
          placeholder: {
            type: "plain_text",
            text: "My Linear Workspace",
          },
        },
      },
    ],
  };
}

/**
 * Build Airtable configuration modal with field mapping
 */
export function buildAirtableConfigModal(existingConfig?: any) {
  const fieldMapping = (existingConfig?.field_mapping as any) || {};
  
  return {
    type: "modal",
    callback_id: "airtable_config_modal",
    title: {
      type: "plain_text",
      text: "Configure Airtable",
    },
    submit: {
      type: "plain_text",
      text: "Save",
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
          text: "Connect your Airtable base to export insights as records.",
        },
      },
      {
        type: "input",
        block_id: "airtable_api_key",
        label: {
          type: "plain_text",
          text: "Airtable Personal Access Token",
        },
        element: {
          type: "plain_text_input",
          action_id: "api_key_input",
          placeholder: {
            type: "plain_text",
            text: "pat_xxxxxxxxxxxx",
          },
        },
        hint: {
          type: "plain_text",
          text: "Get from Airtable > Account > Developer Hub > Personal Access Tokens",
        },
      },
      {
        type: "input",
        block_id: "airtable_base_id",
        label: {
          type: "plain_text",
          text: "Base ID",
        },
        element: {
          type: "plain_text_input",
          action_id: "base_id_input",
          placeholder: {
            type: "plain_text",
            text: "appXXXXXXXXXXXXXX",
          },
        },
        hint: {
          type: "plain_text",
          text: "Find in your base URL: airtable.com/appXXX/...",
        },
      },
      {
        type: "input",
        block_id: "airtable_table_name",
        label: {
          type: "plain_text",
          text: "Table Name",
        },
        element: {
          type: "plain_text_input",
          action_id: "table_name_input",
          initial_value: existingConfig?.table_name || "Insights",
          placeholder: {
            type: "plain_text",
            text: "Insights",
          },
        },
      },
      {
        type: "input",
        block_id: "airtable_label",
        optional: true,
        label: {
          type: "plain_text",
          text: "Connection Label",
        },
        element: {
          type: "plain_text_input",
          action_id: "label_input",
          initial_value: existingConfig?.label || "My Airtable Base",
          placeholder: {
            type: "plain_text",
            text: "My Airtable Base",
          },
        },
      },
      {
        type: "divider",
      },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Field Mapping",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Map MeetyAI insight fields to your Airtable column names. Leave blank to use defaults.",
          },
        ],
      },
      {
        type: "input",
        block_id: "airtable_field_title",
        optional: true,
        label: {
          type: "plain_text",
          text: "Title Field",
        },
        element: {
          type: "plain_text_input",
          action_id: "field_input",
          initial_value: fieldMapping.title || "Title",
          placeholder: {
            type: "plain_text",
            text: "Title",
          },
        },
      },
      {
        type: "input",
        block_id: "airtable_field_description",
        optional: true,
        label: {
          type: "plain_text",
          text: "Description Field",
        },
        element: {
          type: "plain_text_input",
          action_id: "field_input",
          initial_value: fieldMapping.description || "Description",
          placeholder: {
            type: "plain_text",
            text: "Description",
          },
        },
      },
      {
        type: "input",
        block_id: "airtable_field_type",
        optional: true,
        label: {
          type: "plain_text",
          text: "Type Field",
        },
        element: {
          type: "plain_text_input",
          action_id: "field_input",
          initial_value: fieldMapping.type || "Type",
          placeholder: {
            type: "plain_text",
            text: "Type",
          },
        },
      },
      {
        type: "input",
        block_id: "airtable_field_confidence",
        optional: true,
        label: {
          type: "plain_text",
          text: "Confidence Field",
        },
        element: {
          type: "plain_text_input",
          action_id: "field_input",
          initial_value: fieldMapping.confidence || "Confidence",
          placeholder: {
            type: "plain_text",
            text: "Confidence",
          },
        },
      },
      {
        type: "input",
        block_id: "airtable_field_author",
        optional: true,
        label: {
          type: "plain_text",
          text: "Author Field",
        },
        element: {
          type: "plain_text_input",
          action_id: "field_input",
          initial_value: fieldMapping.author || "Author",
          placeholder: {
            type: "plain_text",
            text: "Author",
          },
        },
      },
      {
        type: "input",
        block_id: "airtable_field_evidence",
        optional: true,
        label: {
          type: "plain_text",
          text: "Evidence Field",
        },
        element: {
          type: "plain_text_input",
          action_id: "field_input",
          initial_value: fieldMapping.evidence || "Evidence",
          placeholder: {
            type: "plain_text",
            text: "Evidence",
          },
        },
      },
      {
        type: "input",
        block_id: "airtable_field_source",
        optional: true,
        label: {
          type: "plain_text",
          text: "Source Field",
        },
        element: {
          type: "plain_text_input",
          action_id: "field_input",
          initial_value: fieldMapping.source || "Source",
          placeholder: {
            type: "plain_text",
            text: "Source",
          },
        },
      },
      {
        type: "input",
        block_id: "airtable_field_status",
        optional: true,
        label: {
          type: "plain_text",
          text: "Status Field",
        },
        element: {
          type: "plain_text_input",
          action_id: "field_input",
          initial_value: fieldMapping.status || "Status",
          placeholder: {
            type: "plain_text",
            text: "Status",
          },
        },
      },
    ],
  };
}

/**
 * Build Zoom configuration modal
 */
export function buildZoomConfigModal(existingConfig?: any) {
  return {
    type: "modal",
    callback_id: "zoom_config_modal",
    title: {
      type: "plain_text",
      text: "Configure Zoom",
    },
    submit: {
      type: "plain_text",
      text: "Save",
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
          text: "Connect your Zoom account to automatically import meeting transcripts.",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "MeetyAI will check for new transcripts every hour.",
          },
        ],
      },
      {
        type: "input",
        block_id: "zoom_account_id",
        label: {
          type: "plain_text",
          text: "Zoom Account ID",
        },
        element: {
          type: "plain_text_input",
          action_id: "account_id_input",
          placeholder: {
            type: "plain_text",
            text: "Your Zoom Account ID",
          },
        },
        hint: {
          type: "plain_text",
          text: "From Zoom Marketplace > Server-to-Server OAuth App",
        },
      },
      {
        type: "input",
        block_id: "zoom_client_id",
        label: {
          type: "plain_text",
          text: "Client ID",
        },
        element: {
          type: "plain_text_input",
          action_id: "client_id_input",
          placeholder: {
            type: "plain_text",
            text: "Your OAuth Client ID",
          },
        },
      },
      {
        type: "input",
        block_id: "zoom_client_secret",
        label: {
          type: "plain_text",
          text: "Client Secret",
        },
        element: {
          type: "plain_text_input",
          action_id: "client_secret_input",
          placeholder: {
            type: "plain_text",
            text: "Your OAuth Client Secret",
          },
        },
      },
    ],
  };
}

/**
 * Build per-connection Field Mapping modal with 2-column layout
 * Left column: Meety fields, Right column: Dropdown with actual app fields
 */
export async function buildConnectionFieldMappingModal(configId: string) {
  const prisma = await getPrismaAsync();
  
  const config = await prisma.exportConfig.findUnique({
    where: { id: configId },
  });
  
  if (!config) {
    return {
      type: "modal",
      title: { type: "plain_text", text: "Error" },
      close: { type: "plain_text", text: "Close" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Configuration not found." },
        },
      ],
    };
  }
  
  const { getMeetyFields, fetchFieldsForConfig } = await import("../services/fieldFetcher");
  const meetyFields = getMeetyFields();
  const appFieldsResult = await fetchFieldsForConfig(configId, config.provider);
  const currentMapping = (config.field_mapping as any) || {};
  
  const providerName = config.provider === "airtable" ? "Airtable" : 
                       config.provider === "linear" ? "Linear" : config.provider;
  
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Map Meety fields to ${providerName} fields*\n_${config.label}_`,
      },
    },
    {
      type: "divider",
    },
  ];
  
  if (!appFieldsResult.success || appFieldsResult.fields.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: appFieldsResult.error 
          ? `⚠️ Could not fetch fields: ${appFieldsResult.error}`
          : "⚠️ No fields found. Please check your connection settings.",
      },
    });
    
    return {
      type: "modal",
      callback_id: `field_mapping_${configId}`,
      title: { type: "plain_text", text: "Field Mapping" },
      close: { type: "plain_text", text: "Close" },
      blocks,
    };
  }
  
  const appFields = appFieldsResult.fields;
  
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Found ${appFields.length} fields in your ${providerName} table`,
      },
    ],
  });
  
  const noneOption = { text: { type: "plain_text" as const, text: "(Don't map)" }, value: "__none__" };
  const fieldOptions = appFields.map(f => ({
    text: { type: "plain_text" as const, text: f.name },
    value: f.name,
  }));
  
  for (const meetyField of meetyFields) {
    const currentValue = currentMapping[meetyField.id];
    const isRequired = meetyField.required;
    
    const options = isRequired ? fieldOptions : [noneOption, ...fieldOptions];
    
    let initialOption = options.find(o => o.value === currentValue);
    if (!initialOption && !isRequired) {
      initialOption = noneOption;
    } else if (!initialOption && fieldOptions.length > 0) {
      const defaultMatch = fieldOptions.find(o => 
        o.value.toLowerCase() === meetyField.name.toLowerCase() ||
        o.value.toLowerCase().includes(meetyField.id.toLowerCase())
      );
      initialOption = defaultMatch || fieldOptions[0];
    }
    
    blocks.push({
      type: "section",
      block_id: `mapping_${meetyField.id}`,
      text: {
        type: "mrkdwn",
        text: `*${meetyField.name}*${isRequired ? " _(required)_" : ""}`,
      },
      accessory: {
        type: "static_select",
        action_id: `select_${meetyField.id}`,
        placeholder: {
          type: "plain_text",
          text: "Select field...",
        },
        options,
        ...(initialOption ? { initial_option: initialOption } : {}),
      },
    });
  }
  
  return {
    type: "modal",
    callback_id: `field_mapping_${configId}`,
    private_metadata: JSON.stringify({ configId, provider: config.provider }),
    title: {
      type: "plain_text",
      text: "Field Mapping",
    },
    submit: {
      type: "plain_text",
      text: "Save Mapping",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks,
  };
}
