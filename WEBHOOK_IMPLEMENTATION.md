# Webhook Implementation Summary

## What Was Implemented

I've completed the full bidirectional webhook integration between n8n and MeetyAI.

---

## 1. ✅ Inbound Webhook (n8n → MeetyAI)

### Endpoint: `POST /api/analyze-transcript`

**Full URL**: `https://your-replit-app.replit.app/api/analyze-transcript`

**What it does**:
- Receives transcript from n8n (or any external system)
- Validates request with Zod schemas
- Analyzes transcript using Claude Sonnet 4.5 (4-pass extraction)
- Returns structured JSON with insights
- **Also triggers outbound webhook** if configured

**Status**: ✅ Already implemented in previous commit

### Request Format

```json
{
  "callId": "zoom-meeting-123",
  "source": "n8n_workflow",
  "transcript": "Full transcript text...",
  "startedAt": "2025-01-15T14:00:00Z",
  "topic": "Customer Feedback Session",
  "metadata": {
    "zoomMeetingId": "123456789",
    "duration": 1800,
    "participants": ["john@example.com"]
  }
}
```

### Response Format

```json
{
  "callId": "zoom-meeting-123",
  "source": "n8n_workflow",
  "context": "feedback_session",
  "summary": "Analyzed 30-minute transcript with 2 pain points...",
  "insights": [ /* array of insights */ ],
  "metadata": {
    "processingTimeMs": 23456,
    "insightCount": 2
  }
}
```

---

## 2. ✅ Outbound Webhook (MeetyAI → n8n)

### Your n8n Webhook URL

**URL**: `https://userlane.app.n8n.cloud/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999`

### New Files Created

1. **`src/mastra/services/webhookService.ts`** (280 lines)
   - `sendWebhook()` - Sends analysis results to webhook URL
   - `sendWebhookError()` - Sends error notifications
   - `getWebhookConfig()` - Reads configuration from environment
   - Retry logic with exponential backoff (3 attempts)
   - 30-second timeout per request

2. **`docs/N8N_INTEGRATION_GUIDE.md`** (Complete integration guide)
   - Inbound webhook setup
   - Outbound webhook setup
   - JSON structure documentation
   - n8n node configurations
   - Testing instructions
   - Troubleshooting

### Modified Files

1. **`src/mastra/services/analyzeTranscriptService.ts`**
   - Added `sendWebhook` option to `AnalyzeOptions`
   - Added `webhookUrl` option for custom URL
   - Automatically sends webhook after analysis completes
   - Non-blocking (doesn't slow down API response)

2. **`src/mastra/index.ts`**
   - Updated `/api/analyze-transcript` endpoint
   - Enabled `sendWebhook: true` for all API calls

### Webhook Payload Structure

```json
{
  "event": "analysis.completed",
  "timestamp": "2025-01-15T14:35:22Z",
  "callId": "zoom-meeting-123",
  "source": "n8n_workflow",
  "result": {
    "context": "feedback_session",
    "summary": "Analyzed 30-minute transcript...",
    "insights": [
      {
        "id": "uuid",
        "type": "pain_point",
        "title": "User confusion during onboarding",
        "description": "Full description...",
        "evidence": "[00:15:23] John: \"I was confused\"",
        "confidence": 0.87,
        "confidencePercent": 87,
        "severity": "high",
        "area": "onboarding",
        "suggestedActions": ["Prioritize for investigation"],
        "timestamp": "00:15:23",
        "speaker": "John"
      }
    ],
    "metadata": {
      "processingTimeMs": 23456,
      "model": "claude-sonnet-4-5",
      "insightCount": 2,
      "highConfidenceCount": 2,
      "mediumConfidenceCount": 0,
      "lowConfidenceCount": 0
    }
  }
}
```

### Insight Entity Structure

Each insight has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique UUID |
| `type` | string | pain_point, gain, feature_request, idea, opportunity, risk, blocker, confusion, question, objection, buying_signal, feedback, outcome |
| `title` | string | Short summary (first 100 chars of description) |
| `description` | string | Full detailed text |
| `evidence` | string | Verbatim quote with timestamp |
| `confidence` | number | 0.0 - 1.0 |
| `confidencePercent` | number | 0 - 100 (easier for display) |
| `severity` | string | "high", "medium", "low" |
| `area` | string | "onboarding", "billing", "ux", "performance", etc. |
| `suggestedActions` | string[] | Recommended follow-up actions |
| `timestamp` | string | Time in transcript (e.g., "00:15:23") |
| `speaker` | string | Who mentioned this |

---

## 3. ✅ Slack App Changes

### Current Status: No Changes Required

**Why?**
- Slack integration uses the existing `metiyWorkflow` which already works perfectly
- Slack has specific requirements (thread replies, ephemeral messages, modals)
- The workflow internally uses the same analysis logic (4-pass LLM extraction)
- Slack doesn't need webhook callbacks (it has direct UI interaction)

**What Slack Does**:
1. User opens modal via `/meetyai analyze`
2. User pastes text or link
3. Workflow triggers → Agent analyzes → Results sent to Slack thread
4. User sees insights in Slack

**Slack continues to work as-is** ✅

### Optional Future Enhancement

If you want Slack to also use the new unified service:
- Modify Slack handlers to call `analyzeTranscriptService` directly
- Return insights to Slack instead of triggering workflow
- Would skip webhook sending for Slack (set `sendWebhook: false`)

**Recommendation**: Keep Slack as-is. It works and has its own requirements.

---

## Setup Instructions

### Step 1: Configure Webhook URL in Replit

Add this environment variable:

```bash
N8N_WEBHOOK_URL=https://userlane.app.n8n.cloud/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999
```

**How to add in Replit**:
1. Go to Replit project
2. Click "Secrets" (lock icon) in sidebar
3. Add new secret:
   - Key: `N8N_WEBHOOK_URL`
   - Value: `https://userlane.app.n8n.cloud/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999`

### Step 2: Test Inbound Endpoint

```bash
curl -X POST https://your-replit-app.replit.app/api/analyze-transcript \
  -H "Content-Type: application/json" \
  -d '{
    "callId": "test-123",
    "source": "n8n_workflow",
    "transcript": "Customer said they love the product but find the UI confusing."
  }'
```

**Expected**:
- Returns JSON with insights (synchronous)
- Also sends insights to your n8n webhook (asynchronous)

### Step 3: Verify Webhook Received in n8n

1. Go to your n8n workflow
2. Check webhook node for received data
3. Should see the webhook payload with insights

### Step 4: Set Up n8n Workflow

Follow the guide in `docs/N8N_INTEGRATION_GUIDE.md`:
1. Create webhook trigger
2. Add Code node to process insights
3. Add Linear/Airtable nodes to export
4. Test end-to-end

---

## How It Works (Complete Flow)

### Option A: Synchronous Flow

```
n8n HTTP Request
  ↓ POST /api/analyze-transcript
MeetyAI Backend
  ↓ Analyzes transcript
  ↓ Returns insights JSON
n8n receives response
  ↓ Processes insights
  ↓ Exports to Linear/Airtable
```

### Option B: Webhook Flow (Async)

```
n8n HTTP Request
  ↓ POST /api/analyze-transcript
MeetyAI Backend
  ↓ Returns 200 OK immediately (or with results)
  ↓ Analyzes transcript
  ↓ POSTs results to webhook
n8n Webhook Trigger
  ↓ Receives insights
  ↓ Processes insights
  ↓ Exports to Linear/Airtable
```

### Hybrid Flow (Current Implementation)

```
n8n HTTP Request
  ↓ POST /api/analyze-transcript
MeetyAI Backend
  ↓ Analyzes transcript (sync)
  ↓ Returns insights in response
  ↓ ALSO sends to webhook (async, non-blocking)
n8n receives BOTH:
  1. HTTP response with insights
  2. Webhook POST with insights
```

**Benefits**:
- n8n can use whichever method works better
- HTTP response is immediate (no polling needed)
- Webhook provides backup/alternative integration path

---

## Files Changed

### New Files (2)
1. `src/mastra/services/webhookService.ts` - Webhook sending logic
2. `docs/N8N_INTEGRATION_GUIDE.md` - Complete setup guide

### Modified Files (2)
1. `src/mastra/services/analyzeTranscriptService.ts` - Added webhook support
2. `src/mastra/index.ts` - Enabled webhook for API endpoint

### Total Lines Added: ~400 lines

---

## Testing Checklist

- [ ] Set `N8N_WEBHOOK_URL` in Replit Secrets
- [ ] Rebuild and deploy Replit app
- [ ] Test inbound endpoint with curl
- [ ] Verify webhook received in n8n
- [ ] Set up n8n workflow with webhook trigger
- [ ] Test complete flow: Zoom → n8n → MeetyAI → n8n → Linear
- [ ] Verify insights exported correctly
- [ ] Check logs for any errors

---

## Next Steps

1. **Deploy**: Commit and push changes (done below)
2. **Configure**: Add `N8N_WEBHOOK_URL` to Replit
3. **Test**: Run test curl command
4. **Integrate**: Set up n8n webhook workflow
5. **Validate**: Test end-to-end with real Zoom transcript
6. **Monitor**: Check logs and webhook delivery

---

## Support

- **Integration Guide**: `docs/N8N_INTEGRATION_GUIDE.md`
- **API Reference**: `docs/API.md`
- **Architecture**: `docs/ARCHITECTURE_REDESIGN.md`
