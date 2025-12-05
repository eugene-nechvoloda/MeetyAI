# n8n Integration Guide - Complete Setup

## Overview

This guide shows you how to set up the complete bidirectional integration between n8n and MeetyAI:

1. **Inbound**: n8n sends transcripts → MeetyAI analyzes
2. **Outbound**: MeetyAI sends results → n8n webhook receives

---

## Part 1: Inbound Webhook (n8n → MeetyAI)

### Endpoint Details

**URL**: `https://your-replit-app.replit.app/api/analyze-transcript`
**Method**: `POST`
**Content-Type**: `application/json`

### Request Schema

```typescript
{
  // Required fields
  "callId": string,          // Unique identifier (e.g., zoom meeting ID)
  "source": string,          // "zoom" | "n8n_workflow" | "api_webhook"
  "transcript": string,      // Full transcript text

  // Optional fields
  "startedAt": string,       // ISO 8601: "2025-01-15T14:00:00Z"
  "topic": string,           // Meeting title/topic

  // Optional metadata
  "metadata": {
    "zoomMeetingId": string,
    "duration": number,      // Seconds
    "participants": string[],
    "recordingUrl": string,
    "language": string,      // Default: "en"
    "tags": string[],
    "customFields": {}
  }
}
```

### n8n HTTP Request Node Configuration

```json
{
  "method": "POST",
  "url": "https://your-replit-app.replit.app/api/analyze-transcript",
  "authentication": "none",
  "sendBody": true,
  "contentType": "application/json",
  "bodyParameters": {
    "parameters": [
      {
        "name": "callId",
        "value": "={{ $json.meeting_id }}"
      },
      {
        "name": "source",
        "value": "n8n_workflow"
      },
      {
        "name": "transcript",
        "value": "={{ $json.transcript_text }}"
      },
      {
        "name": "startedAt",
        "value": "={{ $json.start_time }}"
      },
      {
        "name": "topic",
        "value": "={{ $json.topic }}"
      },
      {
        "name": "metadata",
        "value": "={{ JSON.stringify({ zoomMeetingId: $json.meeting_id, duration: $json.duration, participants: $json.participants }) }}"
      }
    ]
  },
  "options": {
    "timeout": 180000,
    "response": {
      "response": {
        "responseFormat": "json"
      }
    }
  }
}
```

### Response Schema

```typescript
{
  "callId": string,
  "source": string,
  "context": string,         // "feedback_session", "research_call", etc.
  "summary": string,

  "insights": [
    {
      "id": string,          // UUID
      "type": string,        // "pain_point", "gain", "feature_request", etc.
      "text": string,        // Full description
      "evidence": string,    // Verbatim quote with timestamp
      "confidence": number,  // 0.0 - 1.0
      "severity": string,    // "high" | "medium" | "low"
      "area": string,        // "onboarding", "billing", etc.
      "suggestedActions": string[],
      "timestamp": string,
      "speaker": string
    }
  ],

  "metadata": {
    "processingTimeMs": number,
    "model": string,
    "insightCount": number,
    "confidenceDistribution": {
      "high": number,
      "medium": number,
      "low": number
    }
  }
}
```

---

## Part 2: Outbound Webhook (MeetyAI → n8n)

### Your n8n Webhook URL

**URL**: `https://userlane.app.n8n.cloud/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999`

### Configure MeetyAI to Send Results

**Option 1: Environment Variable (Recommended)**

In your Replit project, add this environment variable:

```bash
N8N_WEBHOOK_URL=https://userlane.app.n8n.cloud/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999
```

**Option 2: Alternative Environment Variable**

```bash
WEBHOOK_URL=https://userlane.app.n8n.cloud/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999
```

### Webhook Payload Structure

MeetyAI will POST this JSON to your n8n webhook:

```json
{
  "event": "analysis.completed",
  "timestamp": "2025-01-15T14:35:22.123Z",
  "callId": "zoom-meeting-123",
  "source": "n8n_workflow",

  "result": {
    "context": "feedback_session",
    "summary": "Analyzed 30-minute transcript with 2 pain points, 1 feature request",

    "insights": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "type": "pain_point",
        "title": "User confusion during onboarding process",
        "description": "Users find the onboarding process confusing and tooltips unhelpful",
        "evidence": "[00:15:23] John: \"I was pretty confused. The tooltips didn't really help\"",
        "confidence": 0.87,
        "confidencePercent": 87,
        "severity": "high",
        "area": "onboarding",
        "suggestedActions": [
          "Prioritize for immediate investigation",
          "Schedule follow-up with user",
          "Review tooltip content"
        ],
        "timestamp": "00:15:23",
        "speaker": "John"
      },
      {
        "id": "660f9511-f3ac-52e5-b827-557766551111",
        "type": "feature_request",
        "title": "Request for video tutorial or step-by-step guide",
        "description": "User requested video tutorial or step-by-step guide for onboarding",
        "evidence": "[00:17:45] John: \"Maybe a video tutorial or step-by-step guide would be great\"",
        "confidence": 0.92,
        "confidencePercent": 92,
        "severity": "medium",
        "area": "onboarding",
        "suggestedActions": [
          "Add to product backlog",
          "Validate with additional users"
        ],
        "timestamp": "00:17:45",
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

### Insight Entity Structure (Detailed)

Each insight in the `insights` array has this structure:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string | Unique UUID for this insight | `"550e8400-..."` |
| `type` | string | Insight category | `"pain_point"`, `"gain"`, `"feature_request"`, `"idea"`, `"opportunity"`, `"risk"`, `"blocker"`, `"confusion"`, `"question"`, `"objection"`, `"buying_signal"`, `"feedback"`, `"outcome"` |
| `title` | string | Short summary (first 100 chars) | `"User confusion during onboarding"` |
| `description` | string | Full detailed description | `"Users find the onboarding process confusing..."` |
| `evidence` | string (optional) | Verbatim quote with timestamp | `"[00:15:23] John: \"I was confused\""` |
| `confidence` | number | Confidence score (0.0 - 1.0) | `0.87` |
| `confidencePercent` | number | Confidence as percentage (0-100) | `87` |
| `severity` | string | Severity level | `"high"`, `"medium"`, `"low"` |
| `area` | string (optional) | Product area affected | `"onboarding"`, `"billing"`, `"ux"`, `"performance"`, `"integration"`, `"reporting"`, `"collaboration"` |
| `suggestedActions` | string[] (optional) | Recommended follow-up actions | `["Prioritize for investigation", "Schedule follow-up"]` |
| `timestamp` | string (optional) | Time in transcript | `"00:15:23"` |
| `speaker` | string (optional) | Who mentioned this | `"John"` |

---

## Part 3: n8n Webhook Node Setup

### Step 1: Create Webhook Trigger in n8n

1. Add a **Webhook** node to your workflow
2. Set **HTTP Method**: `POST`
3. **Path**: Use the path from your webhook URL: `/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999`
4. **Authentication**: None (or set up if needed)
5. **Response Mode**: Immediately

### Step 2: Process Incoming Data

Add a **Code** node after the webhook to process insights:

```javascript
// Extract insights from webhook payload
const payload = $input.item.json;

if (payload.event === 'analysis.completed') {
  const insights = payload.result.insights;

  // Filter high-confidence insights
  const highConfidenceInsights = insights.filter(
    insight => insight.confidencePercent >= 70
  );

  // Return each insight as separate item for processing
  return highConfidenceInsights.map(insight => ({
    json: {
      // Original insight data
      ...insight,

      // Add metadata from payload
      callId: payload.callId,
      source: payload.source,
      timestamp: payload.timestamp,
      transcriptContext: payload.result.context,
      transcriptSummary: payload.result.summary,

      // Calculate priority
      priority: insight.confidencePercent >= 80 ? 1 : 2,

      // Format for Linear/Airtable
      linearTitle: `[${insight.type.toUpperCase()}] ${insight.title}`,
      linearDescription: `## ${insight.description}\n\n**Evidence:**\n> ${insight.evidence}\n\n**Confidence:** ${insight.confidencePercent}%\n**Severity:** ${insight.severity}\n**Area:** ${insight.area || 'General'}\n\n**Suggested Actions:**\n${insight.suggestedActions?.map(a => `- ${a}`).join('\n') || 'None'}`,
    }
  }));
}

// Return empty for failed events
return [];
```

### Step 3: Export to Linear

Add a **Linear** node:

```json
{
  "resource": "issue",
  "operation": "create",
  "teamId": "YOUR_LINEAR_TEAM_ID",
  "title": "={{ $json.linearTitle }}",
  "description": "={{ $json.linearDescription }}",
  "priority": "={{ $json.priority }}",
  "labelIds": ["INSIGHT_LABEL_ID"]
}
```

### Step 4: Export to Airtable

Add an **Airtable** node:

```json
{
  "operation": "create",
  "baseId": "YOUR_BASE_ID",
  "tableId": "YOUR_TABLE_ID",
  "fields": {
    "Title": "={{ $json.title }}",
    "Description": "={{ $json.description }}",
    "Type": "={{ $json.type }}",
    "Confidence": "={{ $json.confidencePercent }}%",
    "Severity": "={{ $json.severity }}",
    "Evidence": "={{ $json.evidence }}",
    "Area": "={{ $json.area }}",
    "Call ID": "={{ $json.callId }}",
    "Timestamp": "={{ $json.timestamp }}",
    "Speaker": "={{ $json.speaker }}"
  }
}
```

---

## Complete Workflow Example

```
1. Schedule Trigger (Hourly)
   ↓
2. Zoom: Get Recordings
   ↓
3. Filter: Has Transcript
   ↓
4. Zoom: Download Transcript
   ↓
5. HTTP Request: POST to MeetyAI
   → URL: https://your-replit-app.replit.app/api/analyze-transcript
   → Returns: Synchronous response with insights
   ↓
6. Process Insights (optional - if using sync response)
   ↓
7. Export to Linear/Airtable

PARALLEL FLOW (Webhook-based):

A. Webhook Trigger: Receives from MeetyAI
   → URL: https://userlane.app.n8n.cloud/webhook-test/...
   ↓
B. Code: Process Insights
   ↓
C. Linear: Create Issues
   ↓
D. Airtable: Create Records
```

---

## Testing

### Test Inbound (n8n → MeetyAI)

```bash
curl -X POST https://your-replit-app.replit.app/api/analyze-transcript \
  -H "Content-Type: application/json" \
  -d '{
    "callId": "test-123",
    "source": "n8n_workflow",
    "transcript": "Customer said they love the product but find the UI confusing. They suggested adding tooltips and a tutorial."
  }'
```

### Test Outbound (MeetyAI → n8n)

1. Set the environment variable in Replit:
   ```
   N8N_WEBHOOK_URL=https://userlane.app.n8n.cloud/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999
   ```

2. Make a test call to the inbound endpoint (above)

3. Check your n8n webhook for the received payload

---

## Environment Variables Summary

Add these to your Replit project:

```bash
# Required for outbound webhook
N8N_WEBHOOK_URL=https://userlane.app.n8n.cloud/webhook-test/d7d8416b-80f5-45af-afeb-452b229f0999

# Required for LLM analysis
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=<from Replit AI Integrations>
AI_INTEGRATIONS_ANTHROPIC_API_KEY=<from Replit AI Integrations>

# Required for database
DATABASE_URL=<PostgreSQL connection string>

# Optional for context classification
AI_INTEGRATIONS_OPENAI_BASE_URL=<from Replit AI Integrations>
AI_INTEGRATIONS_OPENAI_API_KEY=<from Replit AI Integrations>
```

---

## Troubleshooting

### Webhook not receiving data

1. Check Replit logs for webhook POST attempts
2. Verify `N8N_WEBHOOK_URL` environment variable is set
3. Check n8n webhook is active and listening
4. Test webhook directly with curl

### Analysis timing out

1. Increase timeout in n8n HTTP Request node to 180000ms (3 minutes)
2. Check Replit logs for errors
3. Verify AI Integrations are configured

### Duplicate insights

1. Use unique `callId` values
2. MeetyAI automatically deduplicates by content hash
3. Check n8n workflow isn't running multiple times

---

## Next Steps

1. ✅ Set `N8N_WEBHOOK_URL` in Replit
2. ✅ Test inbound endpoint with curl
3. ✅ Set up n8n webhook trigger
4. ✅ Test end-to-end flow
5. ✅ Configure Linear/Airtable exports
6. ✅ Enable production cron schedule

## Support

- **API Reference**: `docs/API.md`
- **Architecture**: `docs/ARCHITECTURE_REDESIGN.md`
- **Workflow Examples**: `docs/N8N_WORKFLOW_EXAMPLES.md`
