# MeetyAI API Reference

## Base URL

**Production**: `https://your-replit-app.replit.app`
**Local Development**: `http://localhost:5000`

## Authentication

Currently, the API does not require authentication (trusted environment). For production use with public access, consider adding:
- API key authentication via `Authorization` header
- OAuth 2.0 for user-specific access
- IP whitelisting

## Rate Limiting

No rate limits currently enforced. Recommended for production:
- 100 requests per hour per client
- Burst allowance: 10 requests per minute

---

## Endpoints

### 1. Analyze Transcript

Analyzes a transcript using Claude Sonnet 4.5 and returns structured insights.

**Endpoint**: `POST /api/analyze-transcript`

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```typescript
{
  // Required fields
  callId: string;          // Unique identifier for this call/transcript
  source: TranscriptSource; // Source type (see enum below)
  transcript: string;       // Full transcript text (min 10 characters)

  // Optional fields
  startedAt?: string;       // ISO 8601 timestamp (e.g., "2025-01-01T10:00:00Z")
  topic?: string;           // Short title or topic of the call

  // Optional metadata
  metadata?: {
    zoomMeetingId?: string;
    slackChannelId?: string;
    slackUserId?: string;
    slackMessageTs?: string;
    language?: string;      // ISO 639-1 code (default: "en")
    tags?: string[];
    participants?: string[];
    duration?: number;      // Duration in seconds
    recordingUrl?: string;
    customFields?: Record<string, any>;
  }
}
```

**TranscriptSource Enum**:
- `"zoom"` - Zoom meeting recording
- `"slack_upload"` - File uploaded via Slack
- `"slack_text"` - Text pasted in Slack
- `"external_link"` - Link to external transcript
- `"n8n_workflow"` - Sent from n8n workflow
- `"api_webhook"` - Generic API/webhook source
- `"manual"` - Manual entry

**Response** (200 OK):
```typescript
{
  callId: string;
  source: TranscriptSource;
  context?: TranscriptContext;  // Classified context (see enum below)
  summary: string;               // Human-readable summary

  insights: Array<{
    id: string;                  // Stable UUID for this insight
    type: InsightType;           // Type of insight (see enum below)
    text: string;                // Detailed description
    evidence?: string;           // Verbatim quote with timestamp
    confidence: number;          // 0.0 - 1.0 (0% - 100%)
    severity: "high" | "medium" | "low";
    area?: string;               // Product area (e.g., "onboarding", "billing")
    suggestedActions?: string[]; // Recommended follow-up actions
    timestamp?: string;          // Timestamp in transcript
    speaker?: string;            // Speaker who mentioned this
  }>;

  metadata?: {
    processingTimeMs?: number;
    model?: string;              // LLM model used
    insightCount: number;
    confidenceDistribution?: {
      high: number;              // Count of insights with confidence >= 0.8
      medium: number;            // Count of insights with 0.5 <= confidence < 0.8
      low: number;               // Count of insights with confidence < 0.5
    };
  };
}
```

**InsightType Enum**:
- `"pain_point"` - User frustration or problem
- `"gain"` - Positive outcome or benefit
- `"idea"` - User suggestion or idea
- `"opportunity"` - Business or product opportunity
- `"risk"` - Potential risk or concern
- `"feature_request"` - Explicit feature request
- `"blocker"` - Critical blocker preventing progress
- `"confusion"` - User confusion or misunderstanding
- `"question"` - Unanswered question
- `"objection"` - Sales objection or concern
- `"buying_signal"` - Indication of purchase intent
- `"feedback"` - General feedback
- `"outcome"` - Achieved outcome or result

**TranscriptContext Enum**:
- `"research_call"` - Discovery interview
- `"feedback_session"` - Gathering feedback
- `"usability_testing"` - Testing workflows
- `"sales_demo"` - Product demonstration
- `"support_call"` - Customer support
- `"onboarding"` - New user onboarding
- `"brainstorm"` - Ideation session
- `"retrospective"` - Review of past work
- `"general_interview"` - General discussion
- `"unknown"` - Unable to classify

**Error Response** (400, 500):
```typescript
{
  error: {
    code: string;              // "INVALID_REQUEST" | "ANALYSIS_FAILED"
    message: string;           // Human-readable error message
    details?: any;             // Additional context (dev mode only)
  }
}
```

**Example Request**:
```bash
curl -X POST https://your-app.replit.app/api/analyze-transcript \
  -H "Content-Type: application/json" \
  -d '{
    "callId": "zoom-meeting-123",
    "source": "zoom",
    "startedAt": "2025-01-15T14:00:00Z",
    "topic": "Customer Feedback - Onboarding Flow",
    "transcript": "Interviewer: How did you find the onboarding process?\nJohn: Honestly, I was pretty confused. The tooltips didn'\''t really help and I couldn'\''t find where to upload my data.\nInterviewer: What would have helped?\nJohn: Maybe a video tutorial or step-by-step guide would be great.",
    "metadata": {
      "zoomMeetingId": "123456789",
      "duration": 1800,
      "participants": ["john@example.com", "interviewer@company.com"]
    }
  }'
```

**Example Response**:
```json
{
  "callId": "zoom-meeting-123",
  "source": "zoom",
  "context": "feedback_session",
  "summary": "Analyzed 30-minute transcript with 2 pain points, 1 feature request extracted",
  "insights": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "pain_point",
      "text": "User confusion during onboarding process",
      "evidence": "[00:01:23] John: \"I was pretty confused. The tooltips didn't really help\"",
      "confidence": 0.87,
      "severity": "high",
      "area": "onboarding",
      "suggestedActions": [
        "Prioritize for immediate investigation",
        "Schedule follow-up with user",
        "Review tooltip content"
      ],
      "timestamp": "00:01:23",
      "speaker": "John"
    },
    {
      "id": "660f9511-f3ac-52e5-b827-557766551111",
      "type": "feature_request",
      "text": "Request for video tutorial or step-by-step guide",
      "evidence": "[00:02:45] John: \"Maybe a video tutorial or step-by-step guide would be great\"",
      "confidence": 0.92,
      "severity": "medium",
      "area": "onboarding",
      "suggestedActions": [
        "Add to product backlog",
        "Validate with additional users"
      ],
      "timestamp": "00:02:45",
      "speaker": "John"
    }
  ],
  "metadata": {
    "processingTimeMs": 23456,
    "model": "claude-sonnet-4-5",
    "insightCount": 2,
    "confidenceDistribution": {
      "high": 2,
      "medium": 0,
      "low": 0
    }
  }
}
```

---

### 2. Legacy Webhook Endpoint (Deprecated)

**Endpoint**: `POST /api/webhooks/transcript`

⚠️ **This endpoint is deprecated**. Use `/api/analyze-transcript` instead for new integrations.

**Key Differences**:
- Returns 202 Accepted (queues analysis)
- Does not return insights immediately
- Triggers async workflow instead of synchronous analysis

---

## Usage Examples

### JavaScript/Node.js

```javascript
const analyzeTranscript = async (transcript) => {
  const response = await fetch('https://your-app.replit.app/api/analyze-transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      callId: `custom-${Date.now()}`,
      source: 'api_webhook',
      transcript: transcript,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Analysis failed: ${error.error.message}`);
  }

  const result = await response.json();
  return result;
};

// Usage
const insights = await analyzeTranscript('Your transcript text here...');
console.log(`Found ${insights.insights.length} insights`);
```

### Python

```python
import requests
import json

def analyze_transcript(transcript: str) -> dict:
    url = "https://your-app.replit.app/api/analyze-transcript"

    payload = {
        "callId": f"custom-{int(time.time())}",
        "source": "api_webhook",
        "transcript": transcript
    }

    response = requests.post(url, json=payload, timeout=180)
    response.raise_for_status()

    return response.json()

# Usage
result = analyze_transcript("Your transcript text here...")
print(f"Found {len(result['insights'])} insights")
```

### cURL

```bash
#!/bin/bash

TRANSCRIPT_FILE="transcript.txt"
TRANSCRIPT_TEXT=$(cat "$TRANSCRIPT_FILE")

curl -X POST https://your-app.replit.app/api/analyze-transcript \
  -H "Content-Type: application/json" \
  -d "{
    \"callId\": \"$(date +%s)\",
    \"source\": \"manual\",
    \"transcript\": $(jq -Rs . <<< "$TRANSCRIPT_TEXT")
  }" \
  | jq .
```

---

## Best Practices

### 1. Unique Call IDs
Always use unique `callId` values. The system uses content hashing for deduplication, but unique IDs help with tracing and debugging.

```javascript
// Good
const callId = `zoom-${meeting.id}-${meeting.start_time}`;

// Bad - may cause confusion
const callId = "meeting-1";
```

### 2. Include Metadata
Provide as much metadata as possible for better traceability:

```javascript
{
  callId: meeting.id,
  source: "zoom",
  transcript: meeting.transcript,
  metadata: {
    zoomMeetingId: meeting.id,
    duration: meeting.duration,
    participants: meeting.participants.map(p => p.email),
    recordingUrl: meeting.recording_url,
    language: meeting.language || "en"
  }
}
```

### 3. Handle Timeouts
Analysis can take 30-180 seconds for long transcripts. Set appropriate timeouts:

```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutes

try {
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: controller.signal
  });
  // ... handle response
} finally {
  clearTimeout(timeoutId);
}
```

### 4. Filter Insights by Confidence
Not all insights are equally valuable. Filter by confidence:

```javascript
const highConfidenceInsights = result.insights.filter(
  insight => insight.confidence >= 0.7
);
```

### 5. Batch Processing
For multiple transcripts, process them sequentially to avoid overwhelming the server:

```javascript
const results = [];
for (const transcript of transcripts) {
  const result = await analyzeTranscript(transcript);
  results.push(result);

  // Optional: Add delay between requests
  await new Promise(resolve => setTimeout(resolve, 2000));
}
```

---

## Response Times

| Transcript Length | Expected Time | Notes |
|-------------------|---------------|-------|
| < 500 words       | 10-30s        | Quick analysis |
| 500-2000 words    | 30-60s        | Standard meeting |
| 2000-5000 words   | 60-120s       | Long meeting |
| > 5000 words      | 120-180s      | Very long transcript |

**Factors affecting processing time**:
- Transcript length (primary factor)
- Number of insights extracted (research depth = 0.7)
- LLM API latency
- Server load

---

## Error Handling

### Common Errors

#### 400 Bad Request - Invalid Request
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid request body",
    "details": "callId: Required"
  }
}
```

**Solution**: Check request payload matches schema. Ensure `callId`, `source`, and `transcript` are provided.

#### 500 Internal Server Error - Analysis Failed
```json
{
  "error": {
    "code": "ANALYSIS_FAILED",
    "message": "Transcript analysis failed: Anthropic AI Integration not configured"
  }
}
```

**Solution**: Check server logs. Common causes:
- AI Integration not configured (Replit settings)
- Database connection issues
- LLM API errors

#### 408 Request Timeout
If the request times out, the transcript may be too long or the server is under heavy load.

**Solution**:
- Split very long transcripts into chunks
- Retry with exponential backoff
- Contact support if persists

### Retry Strategy

Implement exponential backoff for transient errors:

```javascript
async function analyzeWithRetry(transcript, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await analyzeTranscript(transcript);
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(`Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

---

## Versioning

**Current Version**: v1 (implicit)

Future versions will be explicitly versioned:
- `/api/v1/analyze-transcript`
- `/api/v2/analyze-transcript`

Breaking changes will require a new version. The current endpoint will remain stable for backward compatibility.

---

## Webhooks (Future)

Coming soon: Register a webhook URL to receive analysis results asynchronously.

```javascript
// Future endpoint
POST /api/webhooks/register
{
  "url": "https://your-app.com/meetyai-callback",
  "events": ["analysis.completed", "analysis.failed"]
}
```

---

## Support

- **Documentation**: [Architecture Redesign](./ARCHITECTURE_REDESIGN.md)
- **n8n Examples**: [N8N Workflow Examples](./N8N_WORKFLOW_EXAMPLES.md)
- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Email**: support@your-domain.com

---

## Changelog

### 2025-01-15 - Initial Release
- Added `POST /api/analyze-transcript` endpoint
- Standardized request/response format with Zod validation
- Support for multiple transcript sources
- Context classification (research_call, feedback_session, etc.)
- Structured insights with confidence scores and suggested actions
