# Transcript Upload Issues - Root Cause Analysis & Fix

## 🔴 Issues Identified

### Issue 1: Workflow Never Updates Transcript Status
**Root Cause**: The `transcriptIngestion` service creates transcripts with status `file_uploaded`, triggers the workflow, but the workflow NEVER updates the status as it progresses.

**Evidence**:
- `transcriptIngestion.ts:173` - Creates transcript with `TranscriptStatus.file_uploaded`
- `transcriptIngestion.ts:226-243` - Triggers workflow via HTTP
- **BUT**: No code in workflow or tools updates the status during/after analysis

**Impact**:
- Transcripts appear stuck in "Pending" (file_uploaded status)
- Users see "⏳ Pending..." forever
- App Home doesn't show completed status
- Insights are extracted but status never changes to "completed"

---

### Issue 2: Transcript Shows in Database But Not in UI
**Root Cause**: App Home auto-correction logic (lines 243-265 in `appHomeViews.ts`) tries to fix stuck transcripts by checking if insights exist, but this only runs when user manually views the page.

**Evidence**:
- `appHomeViews.ts:244-265` - Auto-correction only runs when building the view
- No proactive status updates when workflow completes
- Status correction is reactive, not proactive

**Impact**:
- Transcript exists in database with insights
- But shows as "Pending" until user refreshes
- Even with our recent App Home refresh fix, status is still wrong in DB

---

### Issue 3: No Batch Processing Support
**Root Cause**: Each upload triggers a separate workflow HTTP call, no coordination.

**Evidence**:
- Each `ingestTranscript()` call triggers workflow independently
- No queue or batch mechanism
- Workflows can run in parallel (good) but no visibility

**Impact**:
- Multiple uploads work but status tracking is broken for each
- No way to see overall progress

---

### Issue 4: Stuck Transcripts Never Recover
**Root Cause**: If workflow fails or gets interrupted, transcript stays in `file_uploaded` forever.

**Evidence**:
- `transcriptIngestion.ts:114` - Checks if status is `file_uploaded` and retriggers
- But this only runs when duplicate content is uploaded
- No background job to fix stuck transcripts

---

## ✅ Solution

### Fix 1: Add Status Updates to Workflow

**File**: `src/mastra/workflows/metiyWorkflow.ts`

Add status updates at key stages:

1. **Start of workflow** → `analyzing_pass_1`
2. **After agent completes** → `compiling_insights`
3. **After insights saved** → `completed`
4. **On error** → `failed`

**Implementation**:
```typescript
// At start of agent step
await updateTranscriptStatus(transcriptId, 'analyzing_pass_1', logger);

// After agent completes successfully
await updateTranscriptStatus(transcriptId, 'compiling_insights', logger);

// After sending reply (success)
await updateTranscriptStatus(transcriptId, 'completed', logger);

// On error
await updateTranscriptStatus(transcriptId, 'failed', logger);
```

---

### Fix 2: Ensure Transcript ID is Passed Through Workflow

**Current flow**:
- Modal submission → calls workflow with `transcriptId` in inputData
- But workflow might not be using it

**Fix**: Verify workflow receives and uses `transcriptId` parameter.

---

### Fix 3: Create Stuck Transcript Recovery Endpoint

**New endpoint**: `POST /api/admin/recover-stuck-transcripts`

Finds transcripts with:
- Status = `file_uploaded`
- Created > 5 minutes ago
- No insights

Then retriggers workflow for each.

---

### Fix 4: Better Error Handling

If workflow fails:
1. Update status to `failed`
2. Log error to `transcriptActivity`
3. Send error notification to user (optional)

---

## 🔧 Implementation Plan

### Step 1: Update Workflow with Status Tracking
- Import `updateTranscriptStatus` from `transcriptIngestion`
- Add status updates at key points
- Handle errors gracefully

### Step 2: Test with Single Upload
- Upload one transcript
- Watch logs for status updates
- Verify App Home shows correct status

### Step 3: Test with Multiple Uploads
- Upload 3-5 transcripts
- Verify all appear in Transcripts tab
- Verify all get processed (parallel or sequential)
- Verify all show correct final status

### Step 4: Clean Up Stuck Transcripts
- Find all transcripts with status `file_uploaded` + no insights
- Retrigger workflows for them
- Or mark as failed if too old

---

## 🎯 Expected Behavior After Fix

1. **Upload transcript** → Shows in Transcripts tab immediately with "⏳ Pending..."
2. **Workflow starts** → Status changes to "🔍 Analyzing (1/4)..."
3. **Analysis runs** → Status updates through passes
4. **Insights saved** → Status changes to "📋 Compiling insights..."
5. **Reply sent** → Status changes to "✅ Processed" with insight count
6. **App Home refreshes** → Shows updated status immediately

---

## 📊 Current vs Fixed Flow

### Current (Broken)
```
Upload → DB (file_uploaded) → Trigger workflow → Analysis → Insights saved → Reply sent
         ↓
         Status NEVER changes
         ↓
         User sees "Pending" forever
```

### Fixed
```
Upload → DB (file_uploaded) → Trigger workflow → Status: analyzing_pass_1
                                                ↓
                                         Analysis runs
                                                ↓
                                         Status: compiling_insights
                                                ↓
                                         Insights saved
                                                ↓
                                         Reply sent
                                                ↓
                                         Status: completed
                                                ↓
                                         App Home refreshes
                                                ↓
                                         User sees "✅ Processed"
```

---

## 🧪 Testing Checklist

- [ ] Upload single transcript via Slack modal
- [ ] Verify transcript appears in Transcripts tab
- [ ] Verify status changes from Pending → Analyzing → Completed
- [ ] Verify insights appear in Insights tab
- [ ] Upload multiple transcripts (3-5)
- [ ] Verify all appear in Transcripts tab
- [ ] Verify all get processed
- [ ] Verify all show correct status
- [ ] Test Zoom integration (multiple meetings)
- [ ] Verify Zoom transcripts process correctly
- [ ] Test recovery of stuck transcripts
- [ ] Verify old stuck transcripts can be retrigger

---

## 📝 Files to Modify

1. **`src/mastra/workflows/metiyWorkflow.ts`**
   - Add status updates throughout workflow
   - Import `updateTranscriptStatus`
   - Handle errors properly

2. **`src/mastra/services/transcriptIngestion.ts`** (already good)
   - Has `updateTranscriptStatus` function
   - Just needs to be called from workflow

3. **New file**: `src/mastra/services/recoveryService.ts`
   - Function to find stuck transcripts
   - Function to retrigger workflows
   - Can be called via admin endpoint

---

## 🚨 Critical Issues to Fix Now

1. ✅ **Workflow status updates** - CRITICAL (transcripts stuck forever)
2. ✅ **Error handling** - HIGH (failed transcripts stay in limbo)
3. ✅ **Stuck transcript recovery** - MEDIUM (fix existing issues)
4. ✅ **Multiple upload support** - ALREADY WORKS (just need status fixes)

---

## 💡 Quick Win: Manual Recovery

If you have stuck transcripts right now, run this in database:

```sql
-- Find stuck transcripts
SELECT id, title, status, created_at, slack_user_id
FROM "Transcript"
WHERE status = 'file_uploaded'
  AND created_at < NOW() - INTERVAL '5 minutes'
  AND archived = false;

-- Option 1: Mark as failed (if too old or broken)
UPDATE "Transcript"
SET status = 'failed'
WHERE status = 'file_uploaded'
  AND created_at < NOW() - INTERVAL '1 hour';

-- Option 2: Get transcript IDs to manually retrigger
-- Then call workflow endpoint for each:
-- POST /api/workflows/metiyWorkflow/start
-- with transcript ID and content
```

---

Ready to implement the fixes?
