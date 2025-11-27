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
        
        // If no insights, show "Re-analyze" button; otherwise show "View Insights"
        const buttonConfig = insightCount === 0
          ? {
              type: "button",
              text: {
                type: "plain_text",
                text: "🔄 Re-analyze",
              },
              action_id: "reanalyze_transcript",
              value: transcript.id,
              style: "primary",
            }
          : {
              type: "button",
              text: {
                type: "plain_text",
                text: "View Insights",
              },
              action_id: "view_transcript_insights",
              value: transcript.id,
            };
        
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${transcript.title}*\n📅 ${date} • 💡 ${insightCount} insights${insightCount === 0 ? " ⚠️" : ""}`,
          },
          accessory: buttonConfig,
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
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Field Mapping*\nCustomize how MeetyAI fields map to your export destinations",
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Configure",
          },
          action_id: "configure_field_mapping",
        },
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
 * Build Airtable configuration modal
 */
export function buildAirtableConfigModal(existingConfig?: any) {
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
 * Build Field Mapping configuration modal
 */
export async function buildFieldMappingModal(userId: string) {
  const prisma = await getPrismaAsync();
  
  const exportConfigs = await prisma.exportConfig.findMany({
    where: { user_id: userId },
  });
  
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Configure how MeetyAI insight fields map to your export destinations.*",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "MeetyAI Fields: Title, Description, Type, Confidence, Evidence, Source",
        },
      ],
    },
    {
      type: "divider",
    },
  ];
  
  // Add field mapping for each configured export
  for (const config of exportConfigs) {
    if (config.provider === "linear") {
      const mapping = (config.field_mapping as any) || {};
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Linear* (${config.label})`,
          },
        },
        {
          type: "input",
          block_id: `linear_title_field_${config.id}`,
          label: {
            type: "plain_text",
            text: "Title maps to",
          },
          element: {
            type: "plain_text_input",
            action_id: "field_input",
            initial_value: mapping.title || "title",
            placeholder: { type: "plain_text", text: "title" },
          },
        },
        {
          type: "input",
          block_id: `linear_description_field_${config.id}`,
          label: {
            type: "plain_text",
            text: "Description maps to",
          },
          element: {
            type: "plain_text_input",
            action_id: "field_input",
            initial_value: mapping.description || "description",
            placeholder: { type: "plain_text", text: "description" },
          },
        },
        { type: "divider" }
      );
    }
    
    if (config.provider === "airtable") {
      const mapping = (config.field_mapping as any) || {};
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Airtable* (${config.label})`,
          },
        },
        {
          type: "input",
          block_id: `airtable_title_field_${config.id}`,
          label: {
            type: "plain_text",
            text: "Title maps to",
          },
          element: {
            type: "plain_text_input",
            action_id: "field_input",
            initial_value: mapping.title || "Title",
            placeholder: { type: "plain_text", text: "Title" },
          },
        },
        {
          type: "input",
          block_id: `airtable_description_field_${config.id}`,
          label: {
            type: "plain_text",
            text: "Description maps to",
          },
          element: {
            type: "plain_text_input",
            action_id: "field_input",
            initial_value: mapping.description || "Description",
            placeholder: { type: "plain_text", text: "Description" },
          },
        },
        {
          type: "input",
          block_id: `airtable_type_field_${config.id}`,
          optional: true,
          label: {
            type: "plain_text",
            text: "Type maps to (optional)",
          },
          element: {
            type: "plain_text_input",
            action_id: "field_input",
            initial_value: mapping.type || "",
            placeholder: { type: "plain_text", text: "Type" },
          },
        },
        { type: "divider" }
      );
    }
  }
  
  if (exportConfigs.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No export destinations configured yet. Configure Linear or Airtable first._",
      },
    });
  }
  
  return {
    type: "modal",
    callback_id: "field_mapping_modal",
    title: {
      type: "plain_text",
      text: "Field Mapping",
    },
    submit: exportConfigs.length > 0 ? {
      type: "plain_text",
      text: "Save",
    } : undefined,
    close: {
      type: "plain_text",
      text: exportConfigs.length > 0 ? "Cancel" : "Close",
    },
    blocks,
  };
}
