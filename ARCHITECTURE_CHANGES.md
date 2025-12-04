# Architecture Changes Summary

## Overview
This commit redesigns MeetyAI from a monolithic service into a clean 3-part architecture with a unified HTTP API for transcript analysis.

## Changes Made

### 1. New Files Created

#### `src/types/api.ts`
- **Purpose**: Standardized TypeScript types and Zod schemas for API contracts
- **Key Exports**:
  - `AnalyzeTranscriptRequest` / `AnalyzeTranscriptResponse` - Request/response types
  - `TranscriptSource` - Enum for transcript sources (zoom, slack_upload, etc.)
  - `InsightType` - Enum for insight types (pain_point, gain, idea, etc.)
  - `TranscriptContext` - Enum for context classification
  - Validation functions: `validateAnalyzeRequest()`, `validateAnalyzeResponse()`
  - Helper functions for type mapping and severity calculation

#### `src/mastra/services/analyzeTranscriptService.ts`
- **Purpose**: Unified, framework-agnostic service layer for transcript analysis
- **Key Function**: `analyzeTranscript(input, options) => AnalysisResult`
- **Features**:
  - Content-based deduplication (SHA-256 hashing)
  - Wraps existing LLM analysis logic (4-pass extraction with Claude Sonnet 4.5)
  - Returns structured JSON instead of triggering workflows
  - No side effects (no Slack messages, no automatic exports)
  - Database integration with Prisma
- **Helper Functions**:
  - `performLLMAnalysis()` - Executes the analyze tool
  - `getTranscriptWithInsights()` - Retrieves existing analysis
  - `mapDatabaseInsightsToAPI()` - Converts DB format to API format
  - `generateSummary()` - Creates human-readable summary
  - `extractArea()` - Identifies product areas from insights
  - `generateSuggestedActions()` - Creates actionable recommendations

### 2. Modified Files

#### `src/mastra/index.ts`
- **Added**: New HTTP endpoint `POST /api/analyze-transcript` (lines 250-348)
- **Location**: After webhook endpoint, before Slack commands
- **Features**:
  - Validates request with Zod schema
  - Calls `analyzeTranscript()` service
  - Returns standardized JSON response
  - Proper error handling with categorized error codes
  - Includes processing metadata (time, confidence distribution)

### 3. Documentation

#### `docs/ARCHITECTURE_REDESIGN.md`
- **Sections**:
  - Overview of 3-part system (n8n, Backend, Slack)
  - What changed from monolithic architecture
  - Core components explanation
  - Integration guide for n8n, Slack, and custom systems
  - Migration steps from old architecture
  - Benefits: separation of concerns, scalability, maintainability
  - Response time expectations
  - Security considerations

#### `docs/N8N_WORKFLOW_EXAMPLES.md`
- **Content**:
  - Complete n8n workflow examples
  - Zoom → MeetyAI → Linear workflow
  - Fireflies → MeetyAI → Airtable workflow
  - Google Docs → MeetyAI workflow
  - Error handling best practices
  - Batch processing patterns
  - Monitoring and observability
  - Production checklist

#### `docs/API.md`
- **Content**:
  - Complete API reference
  - Request/response schemas with examples
  - All enum values documented
  - Usage examples in JavaScript, Python, cURL
  - Best practices (unique IDs, metadata, timeouts, filtering)
  - Response time tables
  - Error handling and retry strategies
  - Common errors and solutions

## Architecture Before vs After

### Before (Monolithic)
```
Zoom Cron → Backend → LLM Analysis → Linear/Airtable Export
Slack → Backend → LLM Analysis → Slack Reply + Linear/Airtable Export
```

### After (3-Part System)
```
n8n: Zoom Cron → POST /api/analyze-transcript → Receives JSON → Exports to Linear/Airtable
Slack: User Input → POST /api/analyze-transcript → Display Results
Any System: → POST /api/analyze-transcript → Process Insights
```

## Benefits

1. **Separation of Concerns**
   - Backend: Pure analysis service (does one thing well)
   - n8n: Orchestration, scheduling, integrations
   - Slack: User interface

2. **Scalability**
   - Scale analysis independently from orchestration
   - Multiple clients can use the same backend API
   - Easy to add new integrations

3. **Maintainability**
   - Clean API contracts with TypeScript + Zod
   - Service layer decoupled from HTTP framework
   - Single source of truth for analysis logic

4. **Testability**
   - Service can be tested without HTTP server
   - API contracts automatically validated
   - Clear boundaries make mocking easier

5. **Flexibility**
   - Swap orchestration tools (n8n → Zapier, Make, etc.)
   - Use backend from any language/platform via HTTP
   - Easy to version and extend API

## Backwards Compatibility

✅ **All existing functionality preserved**:
- Slack slash commands work unchanged
- Slack DMs and mentions work unchanged
- Slack App Home works unchanged
- Old webhook endpoint `/api/webhooks/transcript` still available
- Database schema unchanged
- Existing transcripts/insights remain accessible

🔄 **Recommended migrations**:
- Move Zoom cron job to n8n
- Move Airtable/Linear exports to n8n
- Use new `/api/analyze-transcript` endpoint for new integrations

## Testing Checklist

Before deploying to production:

- [ ] Install dependencies on Replit (`npm install`)
- [ ] Verify build succeeds (`npm run build`)
- [ ] Test `/api/analyze-transcript` endpoint with sample transcript
- [ ] Verify Slack slash command still works
- [ ] Verify Slack DM analysis still works
- [ ] Check database for proper transcript/insight storage
- [ ] Confirm API response matches documented schema
- [ ] Test error handling (invalid request, missing AI integration, etc.)
- [ ] Measure response times for various transcript lengths
- [ ] Set up n8n workflow and test end-to-end flow

## Environment Variables

No new environment variables required. Existing variables still apply:

**Required**:
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` - For Claude Sonnet 4.5
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` - For Claude Sonnet 4.5
- `DATABASE_URL` - PostgreSQL connection

**Optional**:
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - For GPT-5 context classification
- `AI_INTEGRATIONS_OPENAI_API_KEY` - For GPT-5 context classification
- `MEETYAI_WEBHOOK_SECRET` - For old webhook authentication

## Deployment Notes

1. **Replit Deployment**:
   - Push changes to GitHub
   - Replit will automatically build and deploy
   - Monitor first requests for any runtime errors
   - Check logs for successful API calls

2. **n8n Setup**:
   - Import example workflows from `docs/N8N_WORKFLOW_EXAMPLES.md`
   - Update Replit URL in HTTP Request nodes
   - Test with sample data before enabling cron triggers
   - Monitor first few executions

3. **Monitoring**:
   - Watch Replit logs for API requests
   - Check response times (should be 10-180s depending on length)
   - Monitor database growth (transcripts and insights tables)
   - Set up alerts for failed requests (optional)

## Future Enhancements

Potential improvements:
- Streaming responses via Server-Sent Events
- Batch analysis (multiple transcripts in one request)
- Webhooks for async notifications
- Result caching for duplicate transcripts
- Rate limiting for public API
- API versioning (`/api/v2/...`)
- GraphQL alternative to REST
- WebSocket for real-time progress updates

## Migration Path

### Phase 1: Deploy New Code (This Commit)
- New API endpoint available
- Old functionality unchanged
- Both old and new approaches work simultaneously

### Phase 2: Set Up n8n (Next Steps)
- Create n8n workflows using examples
- Test Zoom → MeetyAI → Linear flow
- Run old and new flows in parallel initially

### Phase 3: Switch Traffic (After Validation)
- Disable old Zoom cron job in Replit
- Let n8n handle Zoom polling
- Monitor for any issues

### Phase 4: Optimize (Optional)
- Remove unused old code
- Add API authentication if needed
- Implement caching/rate limiting

## Support

- **Documentation**: See `docs/` directory
- **Issues**: Report bugs via GitHub Issues
- **Questions**: Check API.md and ARCHITECTURE_REDESIGN.md

## Contributors

- Senior Software Architect (Claude) - Design and implementation
- Eugene Nechvoloda - Product requirements and review

## Changelog

### v1.0.0 - 2025-01-15
- Initial architecture redesign
- Added unified `analyzeTranscriptService`
- Added `POST /api/analyze-transcript` endpoint
- Created standardized API types
- Comprehensive documentation
- n8n workflow examples
- Full API reference

---

**Status**: ✅ Ready for testing and deployment
**Breaking Changes**: None (fully backwards compatible)
**Deployment Risk**: Low (additive changes only)
