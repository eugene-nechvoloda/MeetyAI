# MeetyAI Architecture Redesign

## Overview

MeetyAI has been redesigned from a monolithic service into a clean, 3-part system:

1. **n8n** (External Orchestration Layer) - Handles cron jobs, Zoom polling, and exports to Airtable/Linear
2. **MeetyAI Backend** (This Repository) - Core "brain" service that analyzes transcripts using LLMs
3. **Slack App** - User interface for manual transcript submission and interaction

```
┌─────────────────┐
│  MeetyAI Slack  │─────────┐
│      App        │         │
└─────────────────┘         │
                            │  POST /api/analyze-transcript
                            ▼
                   ┌────────────────────┐
                   │   MeetyAI Backend  │
                   │   (Replit + LLM)   │
                   └────────────────────┘
                            ▲
                            │  POST /api/analyze-transcript
                            │
┌─────────────────┐         │
│  Zoom/Fireflies │────────>│
└─────────────────┘         │
                            │
┌─────────────────┐         │
│      n8n        │─────────┘
│  Orchestration  │
└─────────────────┘
         │
         │ Receives insights JSON
         ▼
┌─────────────────┐
│ Linear/Airtable │
└─────────────────┘
```

## What Changed

### Before (Monolithic)
- Backend handled everything: Zoom polling, LLM analysis, Slack, Airtable/Linear exports
- Tight coupling between concerns
- Difficult to scale individual components
- Mixed responsibilities (orchestration + analysis)

### After (3-Part Architecture)
- **Backend**: Pure analysis service with clean HTTP API
- **n8n**: Handles all orchestration, scheduling, and integrations
- **Slack**: Uses the same backend API as n8n (unified interface)

## Core Components

### 1. Unified Service Layer (`analyzeTranscriptService.ts`)

**Location**: `src/mastra/services/analyzeTranscriptService.ts`

**Purpose**: Framework-agnostic service that encapsulates all transcript analysis logic.

**Key Function**:
```typescript
async function analyzeTranscript(
  input: TranscriptInput,
  options?: AnalyzeOptions
): Promise<AnalysisResult>
```

**Features**:
- Content-based deduplication (SHA-256 hashing)
- 4-pass LLM analysis with Claude Sonnet 4.5
- Context classification (research call, feedback session, sales demo, etc.)
- Structured JSON output
- No side effects (no Slack messages, no exports)

### 2. HTTP API Endpoint

**Endpoint**: `POST /api/analyze-transcript`

**Request Format**:
```json
{
  "callId": "unique-call-identifier",
  "source": "zoom" | "slack_upload" | "slack_text" | "external_link" | "n8n_workflow",
  "startedAt": "2025-01-01T10:00:00Z",
  "topic": "Customer feedback session",
  "transcript": "Full transcript text here...",
  "metadata": {
    "zoomMeetingId": "optional-zoom-id",
    "slackChannelId": "optional-channel-id",
    "slackUserId": "optional-user-id",
    "language": "en",
    "tags": ["customer-feedback", "onboarding"],
    "participants": ["john@example.com", "jane@example.com"],
    "duration": 3600,
    "recordingUrl": "https://zoom.us/rec/..."
  }
}
```

**Response Format**:
```json
{
  "callId": "unique-call-identifier",
  "source": "zoom",
  "context": "feedback_session",
  "summary": "Analyzed 60-minute transcript with 3 pain points, 2 feature requests, 1 positive outcome extracted",
  "insights": [
    {
      "id": "uuid-stable-id",
      "type": "pain_point",
      "text": "Users find the onboarding process confusing",
      "evidence": "[00:15:23] John: \"I was really lost during the initial setup\"",
      "confidence": 0.85,
      "severity": "high",
      "area": "onboarding",
      "suggestedActions": [
        "Prioritize for immediate investigation",
        "Schedule follow-up with user"
      ],
      "timestamp": "00:15:23",
      "speaker": "John"
    }
  ],
  "metadata": {
    "processingTimeMs": 45000,
    "model": "claude-sonnet-4-5",
    "insightCount": 6,
    "confidenceDistribution": {
      "high": 3,
      "medium": 2,
      "low": 1
    }
  }
}
```

**Error Response**:
```json
{
  "error": {
    "code": "INVALID_REQUEST" | "ANALYSIS_FAILED",
    "message": "Human-readable error message",
    "details": "Additional context (development only)"
  }
}
```

### 3. API Types (`types/api.ts`)

**Location**: `src/types/api.ts`

**Purpose**: Zod schemas and TypeScript types for API contracts.

**Key Types**:
- `TranscriptSource` - Source of the transcript
- `TranscriptMetadata` - Additional metadata
- `AnalyzeTranscriptRequest` - Request body schema
- `AnalyzeTranscriptResponse` - Response body schema
- `Insight` - Individual insight structure
- `InsightType` - Types of insights (pain_point, gain, idea, etc.)
- `Severity` - Severity levels (high, medium, low)

**Validation Functions**:
- `validateAnalyzeRequest(body)` - Validates incoming requests
- `validateAnalyzeResponse(data)` - Validates outgoing responses

## Integration Guide

### For n8n Workflows

1. **Zoom Import Workflow**:
   ```javascript
   // In n8n HTTP Request node
   POST https://your-replit-url.replit.app/api/analyze-transcript

   Headers:
   - Content-Type: application/json

   Body:
   {
     "callId": "{{ $json.meeting_id }}",
     "source": "zoom",
     "startedAt": "{{ $json.start_time }}",
     "topic": "{{ $json.topic }}",
     "transcript": "{{ $json.transcript_text }}",
     "metadata": {
       "zoomMeetingId": "{{ $json.meeting_id }}",
       "duration": {{ $json.duration }},
       "participants": {{ $json.participants }}
     }
   }
   ```

2. **Process Response**:
   ```javascript
   // The response contains structured insights
   // that you can then export to Airtable/Linear

   const response = $input.item.json;

   // Export high-confidence insights to Linear
   const highConfidenceInsights = response.insights.filter(
     insight => insight.confidence >= 0.7
   );

   // For each insight, create a Linear issue
   for (const insight of highConfidenceInsights) {
     // Use Linear API node...
   }
   ```

### For Slack Integration

The Slack app automatically uses the unified service internally. No changes needed for existing Slack functionality:

- `/meetyai analyze` - Opens modal for transcript submission
- DM the bot - Analyze text or upload files
- Message shortcuts - Right-click "Add to MeetyAI"

### For Custom Integrations

Any system can call the API:

```bash
curl -X POST https://your-replit-url.replit.app/api/analyze-transcript \
  -H "Content-Type: application/json" \
  -d '{
    "callId": "custom-integration-123",
    "source": "api_webhook",
    "transcript": "Your transcript text here...",
    "metadata": {
      "customFields": {
        "integration": "my-custom-tool"
      }
    }
  }'
```

## Migration from Old Architecture

### What Stays the Same

✅ **Existing features continue to work**:
- Slack slash commands (`/meetyai analyze`, `/meetyai settings`)
- Slack DMs and mentions
- Slack App Home with transcripts and insights
- File uploads via Slack
- Database schema (Prisma models unchanged)
- LLM analysis logic (4-pass extraction)
- Export tools (Linear, Airtable) - still available as tools

✅ **Backwards compatibility**:
- Old webhook endpoint `/api/webhooks/transcript` still works
- Existing transcripts and insights in database remain accessible
- Settings, model configs, export configs unchanged

### What Changed

🔄 **Recommended changes for n8n**:

1. **Replace Zoom cron job**:
   - **Before**: Replit cron job polls Zoom every hour
   - **After**: n8n Schedule Trigger → Zoom API → POST /api/analyze-transcript → Linear/Airtable

2. **Replace direct exports**:
   - **Before**: Backend exports to Linear/Airtable after analysis
   - **After**: n8n receives insights JSON → n8n exports to Linear/Airtable

### Migration Steps

1. **Set up n8n workflow**:
   - Create Zoom polling workflow in n8n
   - Call `/api/analyze-transcript` endpoint
   - Export results to Linear/Airtable

2. **Disable old cron job** (optional):
   - The Zoom import workflow (`zoomImportWorkflow`) still runs hourly
   - Once n8n handles Zoom, you can disable it by removing the cron registration in `src/mastra/index.ts:68`

3. **Test the new flow**:
   - Send test transcript to API
   - Verify insights are returned
   - Confirm n8n receives and processes the response

## Development

### Running Locally

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# The API will be available at http://localhost:5000
```

### Testing the API

```bash
# Test the analyze endpoint
curl -X POST http://localhost:5000/api/analyze-transcript \
  -H "Content-Type: application/json" \
  -d @test-request.json

# test-request.json example:
{
  "callId": "test-123",
  "source": "manual",
  "transcript": "Customer said they love the product but find the UI confusing. They suggested adding tooltips."
}
```

### Environment Variables

Required:
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` - Anthropic API base URL (from Replit AI Integrations)
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` - Anthropic API key (from Replit AI Integrations)
- `DATABASE_URL` - PostgreSQL connection string

Optional:
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - OpenAI API base URL (for context classification)
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key (for GPT-5 context classification)
- `MEETYAI_WEBHOOK_SECRET` - Secret for webhook authentication (if using old webhook endpoint)

## Architecture Benefits

### 🎯 Separation of Concerns
- **Backend**: Focus on what it does best - LLM analysis
- **n8n**: Handle orchestration, scheduling, and integrations
- **Slack**: Provide user interface

### 📈 Scalability
- Scale analysis independently from orchestration
- Multiple n8n workflows can call the same backend
- Easy to add new integrations (just call the API)

### 🔧 Maintainability
- Clean API contracts with TypeScript + Zod validation
- Service layer decoupled from HTTP framework
- Single source of truth for analysis logic

### 🧪 Testability
- Service layer can be tested without HTTP server
- API contracts validated automatically
- Clear separation makes mocking easier

### 🔌 Flexibility
- Swap n8n for other orchestration tools (Zapier, Make, etc.)
- Use backend from any system via HTTP API
- Easy to add new sources beyond Zoom

## API Response Times

Expected processing times:
- **Short transcripts** (<1000 words): 10-30 seconds
- **Medium transcripts** (1000-5000 words): 30-90 seconds
- **Long transcripts** (5000+ words): 90-180 seconds

Processing time depends on:
- Transcript length
- Number of insights extracted (research depth 0.7 = 10+ insights/hour)
- LLM API response time (Claude Sonnet 4.5)

## Security

### Authentication
- **Recommended**: Add API key authentication for production
- **Current**: No authentication on `/api/analyze-transcript` (trusted environment)
- **Webhook**: Optional `X-MeetyAI-Secret` header on `/api/webhooks/transcript`

### Data Handling
- Transcripts saved to database with content hash for deduplication
- Sensitive credentials (API keys) encrypted with AES-256-GCM
- Slack tokens managed via Replit OAuth Connectors

## Support

### Troubleshooting

**Error: "Anthropic AI Integration not configured"**
- Solution: Enable Anthropic integration in Replit Settings → AI Integrations

**Error: "Analysis failed"**
- Check logs for detailed error
- Verify transcript is valid text
- Ensure database connection is working

**Insights not being extracted**
- Verify transcript has meaningful content
- Check confidence thresholds in settings
- Review LLM analysis logs

### Documentation
- **API Reference**: This file
- **Original Architecture**: See exploration report from codebase analysis
- **Mastra Framework**: https://mastra.ai/docs

## Future Enhancements

Potential improvements to the architecture:

1. **Streaming responses**: Stream insights as they're discovered (SSE)
2. **Batch analysis**: Analyze multiple transcripts in one request
3. **Webhooks**: Notify external systems when analysis completes
4. **Caching**: Cache analysis results for duplicate transcripts
5. **Rate limiting**: Protect API from abuse
6. **API versioning**: `/api/v1/analyze-transcript` for future changes
7. **GraphQL**: Alternative to REST for more flexible queries
8. **WebSocket**: Real-time progress updates during analysis

## Conclusion

This redesign transforms MeetyAI from a monolithic service into a modern, API-first architecture. The backend is now a focused "brain" service that does one thing well: analyze transcripts and extract insights. All orchestration, scheduling, and integrations move to n8n, creating a clean separation of concerns that's easier to maintain, test, and scale.

The unified service layer ensures that whether a transcript comes from Slack, Zoom via n8n, or any other source, it goes through the same battle-tested analysis pipeline and returns consistent, structured results.
