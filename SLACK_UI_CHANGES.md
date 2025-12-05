# Slack App UI Changes Required

## Issues Identified

### 1. ❌ Export Settings No Longer Needed
**Problem**: Settings modal has "Configure Exports" for Linear/Airtable, but n8n now handles all exports.

**Current behavior**:
- Home tab shows "Configure Exports" button
- Opens export_config_modal for Linear/Airtable setup
- Users can configure export destinations in Slack

**Should be**:
- Remove export configuration UI (n8n handles this)
- Keep model configuration (users can still configure their own AI models)
- Keep general preferences (research depth, notifications)

**Files affected**:
- `src/mastra/index.ts` - Remove export settings modal handlers
- `src/mastra/ui/appHomeViews.ts` - Remove "Configure Exports" button

---

### 2. ⚠️ Transcript Status Not Updating
**Problem**: When a transcript finishes processing, the App Home UI doesn't automatically refresh to show the new status.

**Current behavior**:
- Workflow completes analysis
- Sends Slack message with results
- App Home still shows old status (e.g., "Analyzing...")
- User must manually refresh by clicking tabs

**Should be**:
- Workflow calls `views.publish()` to refresh App Home after completion
- Status immediately shows "✅ Processed" with insight count
- No manual refresh needed

**Note**: There IS auto-correction logic (lines 243-265 in appHomeViews.ts) that fixes stuck statuses when user views the page, but the view should auto-refresh.

---

## Required Changes

### Change 1: Remove Export Settings UI

#### File: `src/mastra/ui/appHomeViews.ts`

**Remove from Home tab** (around line 155):
```typescript
// REMOVE THIS:
{
  type: "button",
  text: { type: "plain_text", text: "⚙️ Settings" },
  action_id: "open_export_settings",
}

// REPLACE WITH:
{
  type: "button",
  text: { type: "plain_text", text: "⚙️ Settings" },
  action_id: "open_general_settings",  // New action for non-export settings
}
```

#### File: `src/mastra/index.ts`

**Remove these action handlers**:
- `open_export_settings` (line ~752)
- `open_insights_export_settings` (line ~941)
- `export_config_modal` view submission (line ~1963)

**Add deprecation notice** (optional):
```typescript
} else if (action.action_id === "open_export_settings") {
  // Show deprecation message
  await slack.chat.postEphemeral({
    channel: payload.channel.id,
    user: userId,
    text: "ℹ️ Export settings have moved to n8n. Insights are now automatically exported via your n8n workflow configuration.",
  });
  return c.json({ ok: true });
}
```

---

### Change 2: Refresh App Home After Analysis

#### File: `src/mastra/workflows/metiyWorkflow.ts`

**Add after sending Slack reply** (around line 156):

```typescript
// After sending the reply, refresh App Home to show updated status
try {
  const { buildHomeTab } = await import("../ui/appHomeViews");
  const homeView = await buildHomeTab(slackUserId);

  await slack.views.publish({
    user_id: slackUserId,
    view: homeView,
  });

  logger?.info("✅ [Workflow] App Home refreshed for user", { slackUserId });
} catch (error) {
  logger?.warn("⚠️ [Workflow] Failed to refresh App Home", {
    error: error instanceof Error ? error.message : String(error)
  });
  // Don't fail the workflow if App Home refresh fails
}
```

---

### Change 3: Update Help Text

#### File: `src/mastra/ui/appHomeViews.ts`

**Update Insights tab description** (around line 390):

```typescript
// OLD:
text: "*Your Insights* 💡\nExtracted insights from your transcripts. Configure export settings to send to Linear or Airtable."

// NEW:
text: "*Your Insights* 💡\nExtracted insights from your transcripts. Insights are automatically exported via your n8n workflow."
```

---

## Implementation Priority

### High Priority (Breaking/Confusing UX)
1. ✅ Remove export settings buttons/modals - Users shouldn't see non-functional features
2. ✅ Add deprecation notice if users try to access old settings

### Medium Priority (UX Enhancement)
3. ✅ Refresh App Home after workflow completes - Better real-time feedback
4. ✅ Update help text to mention n8n - Clear expectations

### Low Priority (Nice to Have)
5. Keep model configuration - Users might want custom AI models
6. Keep general preferences - Still relevant for analysis depth

---

## Testing Checklist

After implementing changes:

- [ ] Home tab doesn't show "Configure Exports" button
- [ ] Clicking old export settings shows deprecation message
- [ ] Upload a transcript and verify App Home auto-refreshes when complete
- [ ] Status shows "✅ Processed" without manual refresh
- [ ] Insights tab help text mentions n8n, not Slack exports
- [ ] Model configuration still works (if keeping)
- [ ] General settings still work (research depth, etc.)

---

## Alternative: Graceful Deprecation

Instead of removing entirely, you could:

1. **Keep the UI but make it read-only**:
   - Show existing export configs but disable editing
   - Add banner: "Export settings have moved to n8n"
   - Link to n8n integration docs

2. **Migration period**:
   - Keep UI for 30 days with deprecation warnings
   - Remove entirely after migration period

**Recommendation**: Remove immediately since n8n is the new standard and keeping confusing UI hurts UX.

---

## Summary

**What to remove**:
- ❌ Export settings button in Home tab
- ❌ Export settings button in Insights tab
- ❌ Export configuration modal
- ❌ Export config submission handlers

**What to keep**:
- ✅ Model configuration (optional - users can configure AI models)
- ✅ General preferences (research depth, notifications)
- ✅ App Home tabs and navigation
- ✅ Status indicators and auto-correction logic

**What to add**:
- ✅ App Home refresh after workflow completion
- ✅ Deprecation notices for old export features
- ✅ Updated help text mentioning n8n

**Impact**: Cleaner UX, no broken features, aligns with new n8n-based architecture
