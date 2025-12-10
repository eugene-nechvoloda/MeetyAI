# Chat Feature Deployment Guide

## Overview
A new conversational chat feature has been added to MeetyAI. Users can now interact with an AI assistant directly through Slack to:
- Ask questions about their transcripts
- Get help with MeetyAI features
- Have natural conversations with context awareness

## Database Changes

### New Tables
1. **ChatConversation** - Tracks chat sessions between users and the AI
2. **ChatMessage** - Stores individual messages in conversations

### New Enums
- `ConversationStatus`: active, archived, deleted
- `MessageRole`: user, assistant, system

## Deployment Steps

### 1. Database Migration
Run the following commands to apply the schema changes:

```bash
# Generate Prisma client with new models
npm run db:generate

# Push schema changes to database (Railway)
npm run db:push

# Or create a migration (recommended for production)
npm run db:migrate
```

### 2. Required Slack Permissions
Ensure your Slack app has these scopes:
- `app_mentions:read` - To handle @mentions
- `chat:write` - To send messages
- `im:history` - To read direct messages
- `im:write` - To send direct messages

### 3. Slack Event Subscriptions
Add these events to your Slack app:
- `app_mention` - When users mention the bot
- `message.im` - For direct messages

### 4. Environment Variables
No new environment variables required. The chat feature uses existing:
- `ANTHROPIC_API_KEY` - For Claude AI responses
- `DATABASE_URL` - For storing conversations
- `SLACK_BOT_TOKEN` - For Slack integration

## Features Implemented

### 1. Start Chat Button
- Added "💬 Start Chat" button to App Home
- Opens a DM with the bot and sends a welcome message

### 2. Direct Message Handler
- Bot responds to direct messages
- Creates/retrieves conversation history
- Maintains context across messages

### 3. App Mention Handler
- Responds when @mentioned in channels
- Works in threads
- Same conversational experience as DMs

### 4. Context-Aware Responses
- If a conversation is linked to a transcript, the bot has access to:
  - Transcript title
  - Extracted insights
  - Transcript context

## Files Modified

### New Files
- `/src/services/chatService.ts` - Core chat logic and AI integration
- `/CHAT_FEATURE_DEPLOYMENT.md` - This deployment guide

### Modified Files
- `/prisma/schema.prisma` - Added chat models
- `/src/slack/handlers.ts` - Added chat event handlers
- `/src/slack/views/appHome.ts` - Added "Start Chat" button

## Testing

### Manual Testing Steps
1. Open MeetyAI App Home in Slack
2. Click "💬 Start Chat" button
3. Send a message in the DM
4. Verify bot responds appropriately
5. Test @mentions in a channel
6. Test conversation continuity (send multiple messages)

### Test Scenarios
- ✅ Start new chat from App Home
- ✅ Send message in DM
- ✅ @mention bot in channel
- ✅ Continue conversation in thread
- ✅ Ask about transcripts
- ✅ Error handling (invalid messages, API failures)

## Rollback Plan
If issues occur, you can disable the chat feature by:
1. Commenting out the chat event handlers in `/src/slack/handlers.ts`:
   - `slack.event('message', ...)`
   - `slack.event('app_mention', ...)`
   - `slack.action('start_chat_button', ...)`
2. Redeploy the application
3. Database tables can remain (they won't cause issues)

## Monitoring
Monitor these logs for chat activity:
- `💬 Creating new conversation for user X`
- `💬 Processing message in conversation X`
- `🤖 Calling Claude API for conversation X`
- `✅ Generated response (X tokens)`

## Cost Considerations
- Each chat message consumes Claude API tokens
- Average conversation: 500-2000 tokens per exchange
- Recommend setting up usage alerts in Anthropic dashboard

## Future Enhancements
- Message streaming for real-time responses
- Conversation management UI (view/archive old chats)
- Ability to link conversations to specific transcripts
- Rich message formatting (buttons, images)
- Conversation export functionality
