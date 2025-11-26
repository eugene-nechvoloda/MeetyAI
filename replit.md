# MeetyAI - Slack Transcript Analysis System

## Overview
MeetyAI is a Slack-native transcript analysis system that uses AI to extract insights from meeting transcripts.

## Current State
- Slack App Home with 3 navigable tabs (Home, Transcripts, Insights)
- Interactive buttons working (tab navigation, modals)
- Upload Transcript modal functional
- Export Settings modal functional

## Architecture

### Slack App Configuration
**CRITICAL:** Both Event Subscriptions AND Interactivity must use the Inngest proxy URL:
```
https://inn.gs/e/vs0Dnaaevt9H46kvSY4g7vQWJxveIGUe_wEiSFy6Dl0tj4FB4pcY
```

The direct app URL (meetyai-eugenenechvolod.replit.app) returns 404 due to Mastra agent-mode deployment routing. All Slack webhooks must go through Inngest.

### Key Files
- `src/triggers/slackTriggers.ts` - Handles both events and interactive payloads
- `src/mastra/ui/appHomeViews.ts` - Slack App Home view builders
- `src/mastra/utils/database.ts` - Prisma database utilities
- `prisma/schema.prisma` - Database schema
- `src/mastra/index.ts` - Mastra instance registration

### Database
- Uses Prisma with PostgreSQL
- Always use `getPrismaAsync()` for async initialization
- Build script copies Prisma client to `.mastra/output` directory

### LLM Configuration
- GPT-5 for context classification (8000-char window)
- Claude Sonnet 4.5 for 4-pass deep extraction (14 insight types)
- Uses Replit AI Integrations (no API keys needed)

## Recent Changes
- 2025-11-26: Fixed Slack interactivity by routing through Inngest proxy URL
- 2025-11-26: Resolved deployment routing issue - both Event Subscriptions and Interactivity use same Inngest URL

## User Preferences
- Prefers GPT-5 for classification, Claude Sonnet 4.5 for extraction
- Transcript inputs: n8n webhook, Slack App Home upload, message actions

## Next Steps
- Implement transcript processing workflow
- Add n8n webhook endpoint for transcript ingestion
- Build 4-pass insight extraction with Claude
- Implement Linear/Airtable export functionality
