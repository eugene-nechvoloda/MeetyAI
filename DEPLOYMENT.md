# 🚀 MeetyAI Deployment Guide

Complete step-by-step guide to deploy your MeetyAI Slack bot with full UI features and n8n integration.

---

## 📋 **Prerequisites**

Before deployment, ensure you have:
- ✅ A Replit account with this project
- ✅ A Slack workspace with admin permissions
- ✅ (Optional) n8n instance for automated transcript fetching

---

## 🎯 **Part 1: Deploy to Replit**

### Step 1: Publish Your App

1. **Click the "Publish" button** in Replit (top-right corner)
2. **Wait for build to complete** - this may take 2-3 minutes
3. **Note your deployment URL** - it will look like: `https://your-app.replit.app`

### Step 2: Connect Slack Integration

After publishing, you'll be prompted to:

1. **Click "Connect Slack"** in the deployment wizard
2. **Authorize the app** to access your Slack workspace
3. **Select the workspace** where you want to install MeetyAI
4. **Grant permissions**:
   - Send messages as bot
   - Read channels
   - Open DMs with users
   - Use slash commands
   - Create and manage modals

The deployment will automatically handle OAuth and store your Slack credentials securely.

---

## 📡 **Quick Reference: API Endpoints**

Your deployed app exposes these endpoints:

| Purpose | Endpoint | Used In |
|---------|----------|---------|
| Slash command: `/meetyai analyze` | `/api/slack/commands/analyze` | Slack App Settings → Slash Commands |
| Slash command: `/meetyai settings` | `/api/slack/commands/settings` | Slack App Settings → Slash Commands |
| Modal submissions (analyze & settings) | `/api/slack/interactivity` | Slack App Settings → Interactivity & Shortcuts |
| Slack events (messages, DMs, mentions) | `/webhooks/slack/action` | Slack App Settings → Event Subscriptions |
| n8n webhook for transcripts | `/api/webhooks/transcript` | n8n HTTP Request node |

---

## 🤖 **Part 2: Configure Slack App**

### Step 3: Set Up Slash Commands

In your Slack App settings (https://api.slack.com/apps):

1. **Navigate to "Slash Commands"** in the left sidebar
2. **Create `/meetyai analyze` command**:
   - **Command**: `/meetyai analyze`
   - **Request URL**: `https://your-app.replit.app/api/slack/commands/analyze`
   - **Short Description**: "Analyze a transcript with AI"
   - **Usage Hint**: `[no parameters needed]`
   - Click **Save**

3. **Create `/meetyai settings` command**:
   - **Command**: `/meetyai settings`
   - **Request URL**: `https://your-app.replit.app/api/slack/commands/settings`
   - **Short Description**: "Configure MeetyAI preferences"
   - **Usage Hint**: `[no parameters needed]`
   - Click **Save**

### Step 4: Enable Interactivity

1. **Navigate to "Interactivity & Shortcuts"**
2. **Enable Interactivity**: Toggle ON
3. **Set Request URL**: `https://your-app.replit.app/api/slack/interactivity`
4. Click **Save Changes**

### Step 5: Configure Event Subscriptions

1. **Navigate to "Event Subscriptions"**
2. **Enable Events**: Toggle ON
3. **Set Request URL**: `https://your-app.replit.app/webhooks/slack/action`
   - ⚠️ **Important**: This endpoint is automatically registered by `registerSlackTrigger` in the code
   - It handles all incoming Slack events (messages, mentions, etc.)
   - Slack will verify this URL is valid when you save
4. **Subscribe to bot events**:
   - `message.channels` - Messages in channels
   - `message.im` - Direct messages
5. Click **Save Changes**

### Step 6: Install to Workspace

1. **Navigate to "Install App"**
2. Click **Reinstall to Workspace** (to apply new permissions)
3. **Authorize** the updated permissions

---

## 🔗 **Part 3: n8n Integration (Optional)**

If you want to automatically fetch transcripts from Zoom/Fireflies/etc.:

### Step 7: Configure n8n Webhook

In your n8n workflow:

1. **Add an HTTP Request node** at the end of your workflow
2. **Configure the request**:
   ```
   Method: POST
   URL: https://your-app.replit.app/api/webhooks/transcript
   Content-Type: application/json
   ```

3. **Set the body** (using n8n expressions):
   ```json
   {
     "transcript": "{{ $json.transcript_text }}",
     "slackUserId": "{{ $json.slack_user_id }}",
     "source": "n8n",
     "meetingId": "{{ $json.meeting_id }}"
   }
   ```

4. **Map your fields**:
   - `transcript` → The full transcript text from Zoom/Fireflies
   - `slackUserId` → The Slack user ID who should receive results
   - `source` → Always "n8n" (for tracking)
   - `meetingId` → Unique meeting identifier

5. **Test the webhook** with sample data

---

## ✅ **Part 4: Testing**

### Test Slash Commands

1. **In Slack, type**: `/meetyai analyze`
   - ✅ A modal should appear
   - ✅ You can paste text OR paste a link
   - ✅ Clicking "Analyze" starts processing
   - ✅ You receive a DM with results

2. **In Slack, type**: `/meetyai settings`
   - ✅ A settings modal appears
   - ✅ You can select AI provider
   - ✅ You can set research depth
   - ✅ You can optionally add your own API key
   - ✅ Clicking "Save" stores preferences

### Test Direct Messages

1. **Send a DM to the MeetyAI bot** with any message
   - ✅ Bot responds intelligently
   - ✅ Conversation history is maintained

### Test n8n Integration

1. **Trigger your n8n workflow**
2. **Check that**:
   - ✅ Webhook receives the payload
   - ✅ Analysis starts automatically
   - ✅ User receives DM with insights

---

## 🔧 **Advanced Configuration**

### Custom API Keys

Users can provide their own API keys via `/meetyai settings`:

1. **Select provider**: Anthropic Claude or OpenAI GPT
2. **Enter API key**: `sk-ant-...` or `sk-...`
3. Keys are **encrypted** before storage in the database

### Research Depth Options

Configure analysis thoroughness:
- **Quick (0.3)**: Fast, fewer insights
- **Standard (0.5)**: Balanced approach
- **Deep (0.7)**: Default - thorough analysis
- **Maximum (1.0)**: Most comprehensive

---

## 🛡️ **Security Notes**

1. **API Keys**: Encrypted using AES-256-CBC before database storage
2. **Environment Variables**: Managed securely by Replit
3. **OAuth Tokens**: Handled by Replit's connector system
4. **Database**: Postgres with SSL in production

---

## 📊 **Database Schema**

The system uses these tables:

- `UserSetting` - User preferences (research depth, etc.)
- `ModelConfig` - Encrypted API keys per user
- `Transcript` - Stored transcripts
- `Insight` - AI-generated insights (pains, features, gains, objections)

---

## 🐛 **Troubleshooting**

### Slash commands not working
- ✅ Verify Request URLs in Slack app settings
- ✅ Check deployment URL is correct
- ✅ Reinstall app to workspace

### Modals not appearing
- ✅ Enable Interactivity in Slack app settings
- ✅ Verify Interactivity URL is correct
- ✅ Check app logs in Replit

### n8n webhook failing
- ✅ Test webhook URL in browser (should return 404 for GET)
- ✅ Verify JSON payload structure
- ✅ Check Replit logs for errors

### Bot not responding to DMs
- ✅ Verify Event Subscriptions are enabled
- ✅ Check `message.im` event is subscribed
- ✅ Reinstall app to workspace

---

## 📞 **Support**

If you encounter issues:

1. **Check Replit logs**: View "Start application" workflow logs
2. **Check Slack API logs**: https://api.slack.com/apps → Your App → Event Subscriptions
3. **Test webhook**: `curl -X POST https://your-app.replit.app/api/webhooks/transcript -H "Content-Type: application/json" -d '{"transcript":"test","slackUserId":"U123","source":"test","meetingId":"test"}'`

---

## 🎉 **You're All Set!**

Your MeetyAI bot is now live with:
- ✅ Interactive Slack UI with modals
- ✅ `/meetyai analyze` slash command
- ✅ `/meetyai settings` configuration
- ✅ n8n webhook integration
- ✅ Secure API key management
- ✅ Deep transcript analysis

Enjoy your AI-powered transcript insights! 🚀
