# n8n Workflow Examples for MeetyAI

This document provides ready-to-use n8n workflow configurations for integrating with the MeetyAI backend.

## Table of Contents
1. [Zoom to MeetyAI to Linear](#zoom-to-meetyai-to-linear)
2. [Fireflies to MeetyAI to Airtable](#fireflies-to-meetyai-to-airtable)
3. [Google Docs to MeetyAI](#google-docs-to-meetyai)
4. [Error Handling Best Practices](#error-handling-best-practices)

---

## Zoom to MeetyAI to Linear

### Overview
Polls Zoom for new recordings hourly, sends transcripts to MeetyAI for analysis, and creates Linear issues for high-confidence insights.

### Workflow Diagram
```
Schedule Trigger (Hourly)
  → Zoom: List Recordings
  → Filter: Has Transcript
  → Loop: Each Recording
    → Zoom: Download Transcript
    → MeetyAI: Analyze Transcript
    → Filter: High Confidence Insights
    → Loop: Each Insight
      → Linear: Create Issue
```

### Node Configuration

#### 1. Schedule Trigger
```json
{
  "rule": {
    "interval": [
      {
        "field": "hours",
        "hoursInterval": 1
      }
    ]
  }
}
```

#### 2. Zoom - List Recordings
```json
{
  "resource": "recording",
  "operation": "list",
  "userId": "me",
  "from": "={{ $now.minus({ hours: 2 }).toISO() }}",
  "to": "={{ $now.toISO() }}"
}
```

**Set Node**: Process Recordings
```javascript
// Keep only recordings with transcripts
const recordings = $input.all();
const withTranscripts = recordings.filter(recording =>
  recording.json.recording_files?.some(file =>
    file.file_type === 'TRANSCRIPT'
  )
);

return withTranscripts.map(recording => ({
  json: recording.json
}));
```

#### 3. Zoom - Get Transcript
```javascript
// HTTP Request node for downloading transcript
{
  "method": "GET",
  "url": "={{ $json.recording_files.find(f => f.file_type === 'TRANSCRIPT').download_url }}",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "zoomApi",
  "options": {
    "redirect": {
      "redirect": {
        "followRedirects": true
      }
    }
  }
}
```

#### 4. MeetyAI - Analyze Transcript
```javascript
// HTTP Request node
{
  "method": "POST",
  "url": "https://your-replit-app.replit.app/api/analyze-transcript",
  "authentication": "none",
  "sendBody": true,
  "bodyParameters": {
    "parameters": [
      {
        "name": "callId",
        "value": "={{ $json.uuid }}"
      },
      {
        "name": "source",
        "value": "zoom"
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
        "name": "transcript",
        "value": "={{ $('Zoom - Get Transcript').item.json.content }}"
      },
      {
        "name": "metadata",
        "value": "={{ JSON.stringify({\n  zoomMeetingId: $json.uuid,\n  duration: $json.duration,\n  participants: $json.participant_audio_files?.length || 0,\n  recordingUrl: $json.share_url\n}) }}"
      }
    ]
  },
  "options": {
    "timeout": 180000
  }
}
```

#### 5. Filter High Confidence Insights
```javascript
// Code node
const response = $input.item.json;

// Filter insights with confidence >= 0.7
const highConfidenceInsights = response.insights.filter(
  insight => insight.confidence >= 0.7
);

// Return each insight as separate item for looping
return highConfidenceInsights.map(insight => ({
  json: {
    ...insight,
    transcriptId: response.callId,
    transcriptTopic: response.summary,
    transcriptSource: response.source
  }
}));
```

#### 6. Linear - Create Issue
```json
{
  "resource": "issue",
  "operation": "create",
  "teamId": "YOUR_LINEAR_TEAM_ID",
  "title": "={{ $json.text }}",
  "description": "## Insight from Transcript\n\n**Type:** {{ $json.type }}\n**Confidence:** {{ Math.round($json.confidence * 100) }}%\n**Severity:** {{ $json.severity }}\n**Area:** {{ $json.area || 'General' }}\n\n### Evidence\n> {{ $json.evidence }}\n\n### Suggested Actions\n{{ $json.suggestedActions?.join('\\n- ') || 'None' }}\n\n---\n**Source:** [{{ $json.transcriptTopic }}](zoom-link)\n**Transcript ID:** {{ $json.transcriptId }}",
  "priority": "={{ $json.confidence >= 0.8 ? 1 : 2 }}",
  "labelIds": ["LABEL_ID_FROM_LINEAR"]
}
```

### Complete Workflow JSON
```json
{
  "name": "Zoom → MeetyAI → Linear",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [{"field": "hours", "hoursInterval": 1}]
        }
      },
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "position": [240, 300]
    },
    {
      "parameters": {
        "resource": "recording",
        "operation": "list",
        "userId": "me",
        "from": "={{ $now.minus({ hours: 2 }).toISO() }}",
        "to": "={{ $now.toISO() }}"
      },
      "name": "Zoom - List Recordings",
      "type": "n8n-nodes-base.zoom",
      "credentials": {
        "zoomApi": {
          "id": "YOUR_ZOOM_CRED_ID"
        }
      },
      "position": [460, 300]
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [[{"node": "Zoom - List Recordings", "type": "main", "index": 0}]]
    }
  }
}
```

---

## Fireflies to MeetyAI to Airtable

### Overview
Polls Fireflies API for new transcripts, analyzes them with MeetyAI, and creates Airtable records.

### Workflow Diagram
```
Schedule Trigger (Every 2 hours)
  → Fireflies: Get Recent Transcripts
  → Loop: Each Transcript
    → MeetyAI: Analyze Transcript
    → Loop: Each Insight
      → Airtable: Create Record
```

### Key Nodes

#### 1. Fireflies - Get Transcripts
```javascript
// HTTP Request node
{
  "method": "POST",
  "url": "https://api.fireflies.ai/graphql",
  "authentication": "headerAuth",
  "sendBody": true,
  "contentType": "application/json",
  "body": {
    "query": "query Transcripts($limit: Int!) { transcripts(limit: $limit) { id title date transcript_url } }",
    "variables": {
      "limit": 10
    }
  }
}
```

#### 2. Fireflies - Download Transcript
```javascript
// HTTP Request node
{
  "method": "GET",
  "url": "={{ $json.transcript_url }}",
  "options": {
    "response": {
      "response": {
        "fullResponse": false,
        "responseFormat": "text"
      }
    }
  }
}
```

#### 3. MeetyAI - Analyze
```javascript
{
  "method": "POST",
  "url": "https://your-replit-app.replit.app/api/analyze-transcript",
  "sendBody": true,
  "bodyParameters": {
    "parameters": [
      {
        "name": "callId",
        "value": "={{ $('Fireflies - Get Transcripts').item.json.id }}"
      },
      {
        "name": "source",
        "value": "api_webhook"
      },
      {
        "name": "topic",
        "value": "={{ $('Fireflies - Get Transcripts').item.json.title }}"
      },
      {
        "name": "transcript",
        "value": "={{ $json }}"
      }
    ]
  }
}
```

#### 4. Airtable - Create Record
```json
{
  "operation": "create",
  "baseId": "YOUR_AIRTABLE_BASE_ID",
  "tableId": "YOUR_TABLE_ID",
  "fields": {
    "Title": "={{ $json.text }}",
    "Description": "={{ $json.text }}",
    "Type": "={{ $json.type }}",
    "Confidence": "={{ Math.round($json.confidence * 100) }}%",
    "Severity": "={{ $json.severity }}",
    "Evidence": "={{ $json.evidence }}",
    "Transcript": "={{ $json.transcriptTopic }}"
  }
}
```

---

## Google Docs to MeetyAI

### Overview
Monitors a specific Google Drive folder for new documents, treats them as transcripts, and analyzes them.

### Workflow Diagram
```
Schedule Trigger (Daily)
  → Google Drive: List Files
  → Filter: New Files Only
  → Google Docs: Get Content
  → MeetyAI: Analyze
  → Slack: Send Summary
```

### Key Nodes

#### 1. Google Drive - List Files
```json
{
  "operation": "list",
  "folderId": "YOUR_FOLDER_ID",
  "queryParameters": "modifiedTime > '{{ $now.minus({ days: 1 }).toISO() }}'"
}
```

#### 2. Google Docs - Get Content
```json
{
  "operation": "get",
  "documentId": "={{ $json.id }}",
  "options": {
    "format": "text/plain"
  }
}
```

#### 3. MeetyAI - Analyze
```javascript
{
  "method": "POST",
  "url": "https://your-replit-app.replit.app/api/analyze-transcript",
  "sendBody": true,
  "bodyParameters": {
    "parameters": [
      {
        "name": "callId",
        "value": "={{ $('Google Drive').item.json.id }}"
      },
      {
        "name": "source",
        "value": "external_link"
      },
      {
        "name": "topic",
        "value": "={{ $('Google Drive').item.json.name }}"
      },
      {
        "name": "transcript",
        "value": "={{ $json.content }}"
      },
      {
        "name": "metadata",
        "value": "={{ JSON.stringify({\n  externalUrl: $('Google Drive').item.json.webViewLink\n}) }}"
      }
    ]
  }
}
```

---

## Error Handling Best Practices

### 1. Add Error Workflow
```json
{
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "ERROR_WORKFLOW_ID"
  }
}
```

### 2. Retry Configuration
For the MeetyAI HTTP Request node:
```json
{
  "options": {
    "timeout": 180000,
    "retry": {
      "retry": {
        "maxRetries": 3,
        "retryInterval": 5000
      }
    }
  }
}
```

### 3. Error Notification (Slack)
```javascript
// If node for error path
{
  "conditions": {
    "boolean": [
      {
        "value1": "={{ $json.error }}",
        "operation": "exists"
      }
    ]
  }
}
```

Slack notification:
```json
{
  "resource": "message",
  "operation": "post",
  "channel": "#alerts",
  "text": "🚨 MeetyAI Analysis Failed\n\nTranscript: {{ $('Zoom').item.json.topic }}\nError: {{ $json.error.message }}\nTime: {{ $now.toISO() }}"
}
```

---

## Advanced: Batch Processing

### Process Multiple Transcripts Efficiently

```javascript
// Code node: Batch Transcripts
const transcripts = $input.all();
const batchSize = 5; // Process 5 at a time

// Split into batches
const batches = [];
for (let i = 0; i < transcripts.length; i += batchSize) {
  batches.push(transcripts.slice(i, i + batchSize));
}

return batches.map((batch, index) => ({
  json: {
    batch: batch.map(t => t.json),
    batchNumber: index + 1,
    totalBatches: batches.length
  }
}));
```

---

## Monitoring and Observability

### Add Logging Node
```javascript
// Code node after MeetyAI analysis
const response = $input.item.json;

// Log to console (visible in n8n execution logs)
console.log('📊 Analysis Complete:', {
  callId: response.callId,
  insightCount: response.insights.length,
  highConfidence: response.insights.filter(i => i.confidence >= 0.8).length,
  processingTime: response.metadata?.processingTimeMs
});

// Return original data
return $input.all();
```

### Track Metrics in Google Sheets
```json
{
  "operation": "appendRow",
  "sheetId": "YOUR_SHEET_ID",
  "values": {
    "Date": "={{ $now.toISO() }}",
    "Transcript ID": "={{ $json.callId }}",
    "Insights": "={{ $json.insights.length }}",
    "Processing Time (s)": "={{ Math.round($json.metadata.processingTimeMs / 1000) }}",
    "Source": "={{ $json.source }}"
  }
}
```

---

## Production Checklist

- [ ] Set proper timeout (180s+) for MeetyAI API calls
- [ ] Configure retry logic (3 retries with 5s interval)
- [ ] Add error workflow for failure notifications
- [ ] Use environment variables for sensitive data (API URLs, credentials)
- [ ] Test with sample data before enabling cron
- [ ] Monitor first few executions for errors
- [ ] Set up alerts for failed executions
- [ ] Document custom workflow changes
- [ ] Add workflow version/changelog comments
- [ ] Test rollback procedure

---

## Troubleshooting

### Issue: Timeout Errors
**Solution**: Increase timeout to 300000ms (5 minutes) for very long transcripts

### Issue: Duplicate Insights
**Solution**: MeetyAI deduplicates by content hash automatically. Ensure `callId` is unique per transcript.

### Issue: No Insights Returned
**Solution**: Check transcript quality. Very short transcripts (<100 words) may not generate insights.

### Issue: Rate Limiting
**Solution**: Add "Wait" node between API calls (e.g., 2 seconds) to avoid overwhelming the backend.

---

## Support

For issues with:
- **n8n workflows**: https://community.n8n.io
- **MeetyAI API**: Check logs in Replit, review `docs/ARCHITECTURE_REDESIGN.md`
- **Zoom API**: https://developers.zoom.us
- **Linear API**: https://developers.linear.app
- **Airtable API**: https://airtable.com/developers

## Example Starter Workflow

Download the complete workflow JSON:
- [zoom-to-linear.json](./n8n-workflows/zoom-to-linear.json)
- [fireflies-to-airtable.json](./n8n-workflows/fireflies-to-airtable.json)

Import into n8n via: Settings → Import from File
