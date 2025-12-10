# MeetyAI Complete Rebuild Specification

## 🎯 Purpose

This document contains the COMPLETE specification for rebuilding MeetyAI from scratch. It serves as the single source of truth for all features, data models, UI patterns, and workflows.

---

## 📊 Database Schema

### Core Models

#### 1. Transcript
**Purpose**: Core entity representing uploaded meeting transcripts

**Fields**:
- `id` (UUID, Primary Key)
- `title` (String) - User-provided title
- `origin` (Enum: TranscriptOrigin) - Where transcript came from
  - `file_upload`
  - `paste`
  - `link`
  - `zoom_import`
  - `fireflies_import`
  - `custom_api`
- `status` (Enum: TranscriptStatus) - Processing status
  - `file_uploaded` - Initial state
  - `transcribing` - Converting audio to text
  - `translating` - Translating to English
  - `analyzing_pass_1` - First analysis pass
  - `analyzing_pass_2` - Second analysis pass
  - `analyzing_pass_3` - Third analysis pass
  - `analyzing_pass_4` - Fourth analysis pass
  - `compiling_insights` - Final compilation
  - `completed` - Processing done
  - `failed` - Processing failed

**Slack Metadata**:
- `slack_user_id` (String) - User who uploaded
- `slack_channel_id` (String) - Channel or DM ID
- `slack_message_ts` (String, Optional) - Message timestamp for updates
- `slack_thread_ts` (String, Optional) - Thread timestamp

**Content**:
- `raw_content` (Text, Optional) - Original upload content
- `transcript_text` (Text, Optional) - Processed transcript text
- `content_hash` (String, Optional) - SHA-256 for deduplication
- `language` (String, Default: "en") - Language code
- `translated` (Boolean, Default: false) - Was translation performed

**Context Classification**:
- `context_theme` (String, Optional) - Type of meeting
  - `research_call`
  - `feedback_session`
  - `usability_testing`
  - `sales_demo`
  - `support_call`
  - `general_interview`
  - etc.
- `context_confidence` (Float, Optional) - Confidence score (0.0 to 1.0)

**Origin-Specific Metadata**:
- `file_name` (String, Optional) - Uploaded file name
- `file_type` (String, Optional) - File type
- `link_url` (String, Optional) - External link URL
- `zoom_meeting_id` (String, Optional) - Zoom meeting ID
- `fireflies_id` (String, Optional) - Fireflies transcript ID

**Processing Metadata**:
- `duration_minutes` (Int, Optional) - Meeting duration
- `participant_count` (Int, Optional) - Number of participants
- `processing_time` (Int, Optional) - Processing time in seconds

**Timestamps**:
- `created_at` (DateTime) - When created
- `updated_at` (DateTime) - Last updated
- `processed_at` (DateTime, Optional) - When processing completed

**Archive**:
- `archived` (Boolean, Default: false) - Soft delete flag
- `archived_at` (DateTime, Optional) - When archived

**Relations**:
- `insights` (One-to-Many → Insight)
- `activities` (One-to-Many → TranscriptActivity)

**Indexes**:
- `slack_user_id`
- `status`
- `origin`
- `created_at`
- `content_hash`
- `(slack_user_id, content_hash, archived)` - Composite
- `archived`

---

#### 2. Insight
**Purpose**: Extracted insights from transcript analysis

**Fields**:
- `id` (UUID, Primary Key)
- `transcript_id` (UUID, Foreign Key → Transcript)

**Content**:
- `title` (String) - Short insight title
- `description` (Text) - Detailed description
- `type` (Enum: InsightType) - Type of insight
  - `pain` - User pain point
  - `blocker` - Critical blocker
  - `feature_request` - Feature request
  - `idea` - User idea
  - `gain` - Positive outcome
  - `outcome` - Result achieved
  - `objection` - User objection
  - `buying_signal` - Sales signal
  - `question` - User question
  - `feedback` - General feedback
  - `confusion` - User confusion
  - `opportunity` - Business opportunity
  - `insight` - General insight
  - `other` - Other
- `category` (String, Optional) - Custom category

**Evidence**:
- `author` (String, Optional) - Speaker who mentioned it
- `evidence_text` (Text, Optional) - Primary quote
- `evidence_quotes` (JSON) - Array of {quote, timestamp, speaker}
- `confidence` (Float) - Confidence score (0.0 to 1.0)

**Deduplication**:
- `content_hash` (String, Optional) - Hash for dedup
- `is_duplicate` (Boolean, Default: false) - Is this a duplicate
- `duplicate_of_id` (String, Optional) - Original insight ID
- `duplicate_similarity` (Float, Optional) - Similarity score

**Metadata**:
- `timestamp_start` (String, Optional) - Start timestamp
- `timestamp_end` (String, Optional) - End timestamp
- `speaker` (String, Optional) - Speaker name

**Status & Export**:
- `status` (Enum: InsightStatus) - Export status
  - `new` - Not exported yet
  - `exported` - Successfully exported
  - `export_failed` - Export failed
  - `archived` - Archived by user
- `approved` (Boolean, Default: false) - User approved
- `approved_at` (DateTime, Optional) - When approved
- `exported` (Boolean, Default: false) - Was exported
- `export_destinations` (JSON, Optional) - Array of export records

**Archive**:
- `archived` (Boolean, Default: false)
- `archived_at` (DateTime, Optional)

**Timestamps**:
- `created_at` (DateTime)
- `updated_at` (DateTime)

**Indexes**:
- `transcript_id`
- `type`
- `status`
- `approved`
- `is_duplicate`
- `content_hash`
- `archived`

---

#### 3. TranscriptActivity
**Purpose**: Audit log for transcript processing events

**Fields**:
- `id` (UUID, Primary Key)
- `transcript_id` (UUID, Foreign Key → Transcript)
- `activity_type` (String) - Type of activity
- `message` (String) - Human-readable message
- `metadata` (JSON, Optional) - Additional data
- `created_at` (DateTime)

**Indexes**:
- `transcript_id`
- `created_at`

---

#### 4. ChatConversation
**Purpose**: AI assistant conversations

**Fields**:
- `id` (UUID, Primary Key)
- `slack_user_id` (String)
- `slack_channel_id` (String, Optional)
- `slack_thread_ts` (String, Optional)
- `title` (String, Optional)
- `status` (Enum: ConversationStatus)
  - `active`
  - `archived`
  - `deleted`
- `transcript_id` (String, Optional) - Linked transcript
- `created_at` (DateTime)
- `updated_at` (DateTime)
- `last_message_at` (DateTime)
- `archived` (Boolean, Default: false)
- `archived_at` (DateTime, Optional)

**Relations**:
- `messages` (One-to-Many → ChatMessage)

**Indexes**:
- `slack_user_id`
- `status`
- `created_at`
- `last_message_at`
- `archived`

---

#### 5. ChatMessage
**Purpose**: Individual chat messages

**Fields**:
- `id` (UUID, Primary Key)
- `conversation_id` (UUID, Foreign Key → ChatConversation)
- `role` (Enum: MessageRole)
  - `user`
  - `assistant`
  - `system`
- `content` (Text)
- `slack_message_ts` (String, Optional)
- `tokens_used` (Int, Optional)
- `model_used` (String, Optional)
- `is_error` (Boolean, Default: false)
- `error_message` (Text, Optional)
- `created_at` (DateTime)

**Indexes**:
- `conversation_id`
- `role`
- `created_at`

---

#### 6. ModelConfig
**Purpose**: User-configured AI models (multi-tenancy)

**Fields**:
- `id` (UUID, Primary Key)
- `user_id` (String) - Slack user ID
- `provider` (String) - `openai`, `anthropic`, `groq`, `ollama`
- `label` (String) - User-friendly name
- `api_key_encrypted` (String) - Encrypted API key
- `is_default` (Boolean, Default: false)
- `model_type` (String) - `analysis`, `writing`, `embeddings`, `whisper`
  - `analysis` - For Claude Sonnet 4.5 (reading and analyzing transcripts)
  - `writing` - For GPT-5 (writing insight titles and descriptions)
  - `embeddings` - For vector embeddings (RAG)
  - `whisper` - For audio transcription
- `model_name` (String, Optional) - e.g., `claude-sonnet-4-5-20250929`, `gpt-5-preview`, `gpt-4o`
- `last_tested` (DateTime, Optional)
- `test_status` (Boolean, Optional)
- `created_at` (DateTime)
- `updated_at` (DateTime)

**Unique Constraint**: `(user_id, provider, label)`

**Indexes**:
- `user_id`
- `provider`
- `model_type`

---

#### 7. ImportSource
**Purpose**: Automated import configurations (Zoom, Fireflies, etc.)

**Fields**:
- `id` (UUID, Primary Key)
- `user_id` (String) - Slack user ID
- `provider` (String) - `zoom`, `google_meet`, `fireflies`, `custom_api`
- `label` (String)
- `enabled` (Boolean, Default: true)

**API Configuration**:
- `api_endpoint` (String) - API endpoint URL to fetch transcripts
- `api_key_encrypted` (String, Optional) - Encrypted API key
- `api_secret_encrypted` (String, Optional) - Encrypted API secret/token
- `oauth_token_encrypted` (String, Optional) - Encrypted OAuth token
- `auth_type` (String) - `api_key`, `oauth`, `basic`, `bearer`

**Schedule**:
- `schedule` (String, Default: "0 * * * *") - Cron expression
- `next_run_at` (DateTime, Optional)

**Filters**:
- `lookback_days` (Int, Optional) - How far back to fetch
- `team_filter` (String, Optional) - Filter by team
- `status_filter` (String, Optional) - Filter by status
- `custom_filters` (JSON, Optional) - Additional custom filters

**Status**:
- `last_run_at` (DateTime, Optional)
- `last_run_status` (String, Optional) - `success`, `failed`, `partial`
- `last_run_error` (Text, Optional) - Error message if failed
- `last_run_count` (Int, Optional) - Number of transcripts fetched
- `connection_tested` (Boolean, Default: false)
- `test_status` (String, Optional) - `success`, `failed`
- `test_error` (Text, Optional)

**Timestamps**:
- `created_at` (DateTime)
- `updated_at` (DateTime)

**Indexes**:
- `user_id`
- `provider`
- `enabled`
- `next_run_at` - For cron job processing

---

#### 8. ExportConfig
**Purpose**: Export destination configurations

**Fields**:
- `id` (UUID, Primary Key)
- `user_id` (String) - Slack user ID
- `provider` (String) - `airtable`, `notion`, `google_sheets`, `linear`, `jira`, `custom_api`
- `label` (String)
- `enabled` (Boolean, Default: true)

**Authentication**:
- `api_key_encrypted` (String) - Encrypted API key
- `api_secret_encrypted` (String, Optional) - Encrypted API secret
- `oauth_token_encrypted` (String, Optional) - Encrypted OAuth token
- `auth_type` (String) - `api_key`, `oauth`, `basic`, `bearer`

**Destination Configuration**:
- `base_id` (String, Optional) - Airtable base ID
- `table_name` (String, Optional) - Airtable table name / destination name
- `team_id` (String, Optional) - Linear team ID
- `project_id` (String, Optional) - Jira project ID / Linear project ID
- `database_id` (String, Optional) - Notion database ID
- `sheet_id` (String, Optional) - Google Sheets spreadsheet ID
- `workspace_id` (String, Optional) - Notion workspace ID
- `api_endpoint` (String, Optional) - Custom API endpoint

**Field Mapping** (JSON):
```json
{
  "insight_title": {
    "provider_field": "Name",
    "provider_field_id": "fld123abc",
    "provider_field_type": "text"
  },
  "insight_description": {
    "provider_field": "Description",
    "provider_field_id": "fld456def",
    "provider_field_type": "long_text"
  },
  "insight_type": {
    "provider_field": "Type",
    "provider_field_id": "fld789ghi",
    "provider_field_type": "select"
  },
  "confidence_score": {
    "provider_field": "Confidence",
    "provider_field_id": "fld012jkl",
    "provider_field_type": "number"
  },
  "evidence_quote": {
    "provider_field": "Evidence",
    "provider_field_id": "fld345mno",
    "provider_field_type": "long_text"
  },
  "speaker": {
    "provider_field": "Speaker",
    "provider_field_id": "fld678pqr",
    "provider_field_type": "text"
  },
  "timestamp": {
    "provider_field": "Timestamp",
    "provider_field_id": "fld901stu",
    "provider_field_type": "text"
  },
  "transcript_title": {
    "provider_field": "Source Meeting",
    "provider_field_id": "fld234vwx",
    "provider_field_type": "text"
  }
}
```

**Available Fields** (JSON):
- Stores fetched field definitions from provider
- Updated when "Connect & Fetch Fields" is clicked
```json
{
  "fields": [
    {
      "id": "fld123abc",
      "name": "Name",
      "type": "text",
      "options": null
    },
    {
      "id": "fld456def",
      "name": "Type",
      "type": "select",
      "options": ["Bug", "Feature", "Improvement"]
    }
  ],
  "fetched_at": "2025-01-10T10:00:00Z"
}
```

**Export Filters**:
- `min_confidence` (Float, Optional) - Minimum confidence to export (0.0-1.0)
- `types_filter` (String[], Default: []) - Which insight types to export
- `exclude_duplicates` (Boolean, Default: true)
- `auto_export` (Boolean, Default: false) - Auto-export new insights

**Status**:
- `connection_tested` (Boolean, Default: false)
- `test_status` (String, Optional) - `success`, `failed`
- `test_error` (Text, Optional)
- `last_export_at` (DateTime, Optional)
- `last_export_count` (Int, Optional)
- `total_exported` (Int, Default: 0)

**Timestamps**:
- `created_at` (DateTime)
- `updated_at` (DateTime)

**Indexes**:
- `user_id`
- `provider`
- `enabled`

---

#### 9. KnowledgeSource
**Purpose**: Knowledge base sources for RAG enrichment

**Fields**:
- `id` (UUID, Primary Key)
- `user_id` (String) - Slack user ID
- `source_type` (String) - `helpdesk`, `website`, `file`, `cloud_link`, `mcp_linear`, `mcp_productboard`
- `label` (String)
- `enabled` (Boolean, Default: true)
- `url` (String, Optional)
- `file_path` (String, Optional)
- `auth_encrypted` (String, Optional)
- `mcp_server_url` (String, Optional)
- `mcp_config` (JSON, Optional)
- `indexed` (Boolean, Default: false)
- `indexed_at` (DateTime, Optional)
- `chunk_count` (Int, Default: 0)
- `pinecone_namespace` (String, Optional)
- `created_at` (DateTime)
- `updated_at` (DateTime)

**Indexes**:
- `user_id`
- `source_type`
- `enabled`
- `indexed`

---

#### 10. SystemInstruction
**Purpose**: Custom LLM instructions and examples

**Fields**:
- `id` (UUID, Primary Key)
- `user_id` (String) - Slack user ID
- `category` (String) - `pain_points`, `opportunities`, `hidden_requests`, `custom`
- `examples` (Text) - User-provided examples
- `enabled` (Boolean, Default: true)
- `created_at` (DateTime)
- `updated_at` (DateTime)

**Indexes**:
- `user_id`
- `category`
- `enabled`

---

#### 11. UserSetting
**Purpose**: User preferences

**Fields**:
- `id` (UUID, Primary Key)
- `user_id` (String, Unique) - Slack user ID
- `research_depth` (Float, Default: 0.7) - How many insights to extract
- `temperature` (Float, Default: 0.35) - LLM temperature
- `auto_approve` (Boolean, Default: false) - Auto-approve insights
- `notify_on_completion` (Boolean, Default: true)
- `notify_on_failure` (Boolean, Default: true)
- `custom_context` (Text, Optional) - User's custom definition of pain points, complaints, etc.
- `insight_examples` (Text, Optional) - User-provided examples of insights
- `created_at` (DateTime)
- `updated_at` (DateTime)

---

## 🎨 Slack UI Specification

### App Home Views

#### Home Tab
**Title**: "📊 MeetyAI - Transcript Analysis"
**Subtitle**: "_Upload and analyze your meeting transcripts_"

**Buttons**:
1. "➕ Upload New Transcript" (Primary)
2. "💬 Start Chat"
3. "⚙️ Settings" (to be added)

**Stats Section**:
- X transcripts analyzed
- Y insights extracted
- Z insights ready to export

**Recent Transcripts Section**:
- Shows last 10 transcripts
- Each transcript shows:
  - Title
  - Status emoji + text (Pending, Analyzing, Completed, Failed)
  - Insight count
  - Upload date
  - Overflow menu: "🔄 Re-analyze", "🗑️ Archive"

#### Transcripts Tab
**Title**: "Your Transcripts 📝"

**Button**: "➕ Upload New Transcript"

**Transcript List**:
- Each entry shows:
  - Date (calendar icon)
  - Status (emoji + text)
  - Title
  - "Analysis in progress. This may take 1-2 minutes..." (if processing)

#### Insights Tab
**Title**: "Your Insights 💡"

**Button**: "📤 Export All"

**Stats**: "📊 X insights | 🆕 Y New | ✅ Z Exported"

**Content**:
- If no insights: "No insights yet. Upload a transcript to extract insights!"
- Otherwise: List of insights with export status

---

### Upload Modal
**Title**: "📝 Upload Transcript"

**Fields**:
1. **Transcript Title** (Required)
   - Placeholder: "e.g., Sales Call with ACME Corp"

2. **Upload File** (Optional)
   - Button: "📎 Upload File"
   - Hint: "Supports text files, transcripts, and documents"
   - Accepted types: TXT, PDF, DOC, DOCX

3. **Or Paste Transcript Text** (Optional)
   - Multiline text input
   - Placeholder: "Paste your transcript here..."

4. **Or Link to Transcript** (Optional)
   - Single-line text input
   - Placeholder: "https://..."

**Buttons**:
- "Cancel"
- "Analyze" (Submit)

**Validation**:
- At least one of: File, Text, or Link must be provided

---

### Settings Modal
**Title**: "⚙️ Settings"

**Tabs**:

#### 1. Analysis Settings
- **Research Depth** slider (0.0 - 1.0)
  - Label: "How many insights to extract"
  - Help text: "0.7 = ~7 insights per hour of conversation"

- **Temperature** slider (0.0 - 1.0)
  - Label: "AI creativity level"
  - Help text: "Lower = more focused, Higher = more creative"

- **Custom Context** (Large text area)
  - Label: "Define what you consider as pain points, hidden complaints, etc."
  - Placeholder: "Example: In our context, a 'pain point' is when users express frustration with workflow inefficiency..."
  - Help text: "This context will be added to the AI's system prompt"

- **Insight Examples** (Large text area)
  - Label: "Provide examples of insights you want to extract"
  - Placeholder: "Example:\nTitle: User frustrated with login process\nDescription: Customer mentioned difficulty remembering password\nType: Pain Point"
  - Help text: "The AI will use these examples to better match your expectations"

- **Auto-approve insights** checkbox

#### 2. Model Configuration
- **Analysis Model** dropdown
  - Options: Claude Sonnet 4.5, GPT-4o, GPT-5 (Preview), Custom
  - Default: Claude Sonnet 4.5

- **Writing Model** dropdown
  - Label: "Model for writing insight titles and descriptions"
  - Options: GPT-5 (Preview), Claude Sonnet 4.5, GPT-4o
  - Default: GPT-5 (Preview)
  - Help text: "GPT-5 provides superior writing quality for final insights"

- **Custom API Keys** (Optional)
  - Anthropic API Key input
  - OpenAI API Key input
  - Test connection button

#### 3. Import Sources
**List of configured sources** with Add New button

**Add Import Source Flow**:
1. **Select Provider**
   - Zoom
   - Google Meet
   - Fireflies
   - Custom API

2. **Configuration Form** (appears after selection):
   - **Label** input: "Friendly name for this import"

   - **API Endpoint** input
     - Placeholder: "https://api.zoom.us/v2/users/me/recordings"
     - Help text: "API endpoint to fetch transcripts"

   - **Authentication**:
     - API Key input
     - API Secret input (if needed)
     - OAuth button (if supported)

   - **Cron Schedule** dropdown
     - Every hour (0 * * * *)
     - Every 6 hours (0 */6 * * *)
     - Every 12 hours (0 */12 * * *)
     - Daily at midnight (0 0 * * *)
     - Custom cron expression input

   - **Filters** (Optional):
     - Lookback days input: "Fetch transcripts from last X days"
     - Team filter input
     - Status filter input

   - **Test Connection** button
   - **Save** button

**Each configured import shows**:
- Label & provider icon
- Status: Active/Paused
- Last run: timestamp
- Next run: timestamp
- Edit/Delete buttons

#### 4. Export Destinations
**List of configured destinations** with Add New button

**Add Export Destination Flow**:
1. **Select Provider**
   - Airtable
   - Linear
   - Notion
   - Jira
   - Google Sheets

2. **Configuration Form** (appears after selection):
   - **Label** input: "Friendly name for this export"

   - **Authentication**:
     - API Key input
     - API Secret input (if needed)
     - OAuth button (if supported by provider)

   - **Connect & Fetch Fields** button
     - Connects to provider
     - Fetches available bases/projects/workspaces
     - Fetches available fields

   - **Select Destination**:
     - For Airtable: Base dropdown → Table dropdown
     - For Linear: Team dropdown → Project dropdown
     - For Notion: Database dropdown
     - For Jira: Project dropdown
     - For Google Sheets: Spreadsheet dropdown → Sheet dropdown

   - **Field Mapping** (Like Zapier):
     ```
     MeetyAI Field          →    Provider Field
     ─────────────────────────────────────────────
     Insight Title          →    [Dropdown: Name/Title/Summary/...]
     Insight Description    →    [Dropdown: Description/Body/Details/...]
     Insight Type           →    [Dropdown: Type/Category/Label/...]
     Confidence Score       →    [Dropdown: Confidence/Score/Rating/...]
     Evidence Quote         →    [Dropdown: Evidence/Quote/Source/...]
     Speaker               →    [Dropdown: Author/Speaker/User/...]
     Timestamp             →    [Dropdown: Time/Timestamp/When/...]
     Transcript Title      →    [Dropdown: Transcript/Meeting/Source/...]
     ```

   - **Export Filters**:
     - Minimum confidence slider (0.0 - 1.0)
     - Insight types multi-select: Pain, Blocker, Feature Request, etc.
     - Exclude duplicates checkbox (default: checked)

   - **Test Export** button (sends 1 test insight)
   - **Save** button

**Each configured export shows**:
- Label & provider icon
- Status: Active/Paused
- Field mapping summary (e.g., "7 fields mapped")
- Last export: timestamp & count
- Edit/Delete buttons

#### 5. Notifications
- **Notify on completion** checkbox
- **Notify on failure** checkbox
- **Slack channel for notifications** dropdown (optional)
  - Default: Direct message to user

---

## 🔄 Transcript Processing Workflow

### Step-by-Step Flow

1. **User Uploads Transcript**
   - Via Upload Modal (file, text, or link)
   - Creates Transcript record with status: `file_uploaded`
   - Slack confirmation: "✅ Transcript uploaded and processing started!"

2. **Background Processing Begins**
   - Status → `analyzing_pass_1`
   - Activity log: "Started analysis"

3. **Multi-Pass Analysis**
   - **Pass 1**: Extract pain points, blockers, opportunities
     - Status → `analyzing_pass_1`
   - **Pass 2**: Extract feature requests, ideas, outcomes
     - Status → `analyzing_pass_2`
   - **Pass 3**: Extract questions, feedback, confusion points
     - Status → `analyzing_pass_3`
   - **Pass 4**: Extract general insights and buying signals
     - Status → `analyzing_pass_4`

4. **Insight Compilation**
   - Status → `compiling_insights`
   - Deduplicate insights
   - Calculate confidence scores
   - Save to database

5. **Completion**
   - Status → `completed`
   - Set `processed_at` timestamp
   - Send Slack DM: "✅ Analysis complete for '{title}'!\n\nFound X insights:\n{summary}"
   - Refresh App Home

6. **Error Handling**
   - If any step fails:
     - Status → `failed`
     - Activity log: Error details
     - Send Slack DM: "❌ Analysis failed for '{title}'"

---

## 🤖 AI Processing Specification

### Dual-Model Architecture

MeetyAI uses a **two-stage AI pipeline** for optimal results:

1. **Analysis Stage** (Claude Sonnet 4.5)
   - Reads and analyzes the full transcript
   - Identifies insight locations, evidence, speakers, timestamps
   - Extracts raw insight data with context
   - Model: `claude-sonnet-4-5-20250929`
   - Max tokens: 8192
   - Temperature: User setting (default 0.35)

2. **Writing Stage** (GPT-5)
   - Takes raw insights from Claude
   - Writes polished titles and descriptions
   - Applies user's custom context and examples
   - Ensures consistency and clarity
   - Model: `gpt-5-preview` (or user-selected)
   - Max tokens: 4096
   - Temperature: 0.3 (for consistency)

### Stage 1: Analysis Prompt (Claude Sonnet 4.5)

```
You are MeetyAI Analysis Engine. Your task is to analyze meeting transcripts and identify insights.

{CUSTOM_CONTEXT}

Extract the following types of insights:
1. **Pain Points**: Problems, frustrations, challenges mentioned
2. **Blockers**: Critical issues preventing progress
3. **Feature Requests**: Explicit requests for new features
4. **Ideas**: Suggestions and proposals from participants
5. **Gains**: Positive outcomes, wins, successes
6. **Outcomes**: Results achieved or decisions made
7. **Objections**: Concerns or hesitations raised
8. **Buying Signals**: Indicators of purchase intent
9. **Questions**: Important questions raised
10. **Feedback**: General feedback about product/service
11. **Confusion**: Areas where participants were confused
12. **Opportunities**: Business opportunities identified

For each insight, extract:
- Type (one of the above)
- Raw content (what was said)
- Evidence (direct quote from transcript)
- Speaker (who said it)
- Timestamp (if available in format HH:MM:SS)
- Context (surrounding conversation)
- Confidence (0.0 to 1.0)

Format your response as JSON:
{
  "summary": "Brief overall summary of the conversation",
  "raw_insights": [
    {
      "type": "pain_point",
      "raw_content": "User expressed frustration about the login process taking too long",
      "evidence": "Direct quote from transcript",
      "speaker": "Speaker name",
      "timestamp": "00:15:23",
      "context": "Surrounding conversation for context",
      "confidence": 0.85
    }
  ]
}

Extract approximately {RESEARCH_DEPTH * 10} insights per hour of conversation.
Be thorough but avoid duplicates.
Focus on actionable insights that teams can use.
```

### Stage 2: Writing Prompt (GPT-5)

```
You are MeetyAI Writing Engine. Your task is to write clear, actionable insight titles and descriptions.

{CUSTOM_CONTEXT}

{INSIGHT_EXAMPLES}

You will receive raw insights from analysis. For each insight, write:
1. **Title**: Clear, concise (max 10 words), action-oriented
2. **Description**: Detailed but scannable (2-3 sentences), includes:
   - What the insight is
   - Why it matters
   - Suggested next steps (if applicable)

Writing guidelines:
- Use active voice
- Be specific and concrete
- Avoid jargon unless necessary
- Match the tone from the examples provided
- Ensure consistency across all insights

Input format:
{
  "type": "pain_point",
  "raw_content": "User expressed frustration...",
  "evidence": "Direct quote...",
  "speaker": "John",
  "context": "..."
}

Output format:
{
  "title": "Login process causes user frustration",
  "description": "Users are experiencing significant delays during login, with some reporting wait times over 30 seconds. This is impacting first impressions and potentially causing abandonment. Consider prioritizing authentication optimization or implementing progress indicators."
}

Return JSON array of refined insights.
```

### Context Classification Prompt (Claude Sonnet 4.5)

```
Classify this meeting transcript into one of the following categories:
- research_call
- feedback_session
- usability_testing
- sales_demo
- support_call
- general_interview
- internal_meeting
- customer_onboarding
- strategy_session
- other

Return JSON:
{
  "context": "category_name",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of classification"
}
```

### Processing Flow

```
1. Transcript Input
   ↓
2. Context Classification (Claude Sonnet 4.5)
   ↓
3. Analysis Pass 1-4 (Claude Sonnet 4.5)
   - Pass 1: Pain points, Blockers, Opportunities
   - Pass 2: Feature requests, Ideas, Outcomes
   - Pass 3: Questions, Feedback, Confusion
   - Pass 4: General insights, Buying signals
   ↓
4. Raw Insights Collected
   ↓
5. Writing Pass (GPT-5)
   - Generate titles
   - Write descriptions
   - Apply user context & examples
   ↓
6. Final Insights
   ↓
7. Deduplication
   ↓
8. Save to Database
```

---

## 📤 Export Functionality

### When to Export
- User clicks "Export All" button
- Individual insight "Export" button
- Automated export (if configured)

### Export Destinations
1. **Airtable**
   - Create records in specified base/table
   - Map fields: title, description, type, confidence, etc.

2. **Linear**
   - Create issues in specified team
   - Set labels based on insight type
   - Add evidence as description

3. **Notion**
   - Add to specified database
   - Create pages with properties

4. **Jira**
   - Create tickets in project
   - Set issue type based on insight type

5. **Google Sheets**
   - Append rows to spreadsheet
   - Include all metadata

### Export Record Format
```json
{
  "provider": "linear",
  "id": "LIN-123",
  "exported_at": "2025-01-10T10:00:00Z",
  "status": "success"
}
```

---

## 🔐 Security & Encryption

### Encrypted Fields
- API keys (ModelConfig.api_key_encrypted)
- Credentials (ImportSource.credentials_encrypted)
- Auth tokens (KnowledgeSource.auth_encrypted)

### Encryption Method
- Algorithm: AES-256-GCM
- Key derivation: PBKDF2
- Salt: Random per encryption

---

## 🎯 Critical Success Criteria

The rebuild is successful when:

✅ **Upload Works**:
- File upload processes correctly
- Text paste works
- Link input works

✅ **Processing Works**:
- Status transitions correctly (file_uploaded → analyzing → completed)
- All 4 analysis passes execute
- Insights are saved to database
- No crashes or infinite loops

✅ **Insights Extracted**:
- Insights have correct types
- Confidence scores are calculated
- Evidence quotes are captured
- Deduplication works

✅ **Slack UI Works**:
- App Home shows transcripts
- Upload modal appears
- Status updates in real-time
- Notifications are sent

✅ **Settings Work**:
- Users can configure models
- Import sources can be set up
- Export destinations can be configured
- Settings are persisted

✅ **Export Works**:
- Insights export to Airtable
- Linear integration works
- Other destinations function
- Export status is tracked

---

## 🚨 Known Issues to Avoid

Based on previous codebase problems:

1. **Don't skip status transitions** - Every step must update status
2. **Don't hang on processing** - Add timeouts and error handling
3. **Don't lose data** - Always save to DB before external API calls
4. **Don't block on errors** - Catch, log, and gracefully fail
5. **Don't forget to refresh UI** - Update App Home after changes
6. **Don't create duplicate insights** - Use content hashing
7. **Don't ignore user settings** - Apply research_depth, temperature
8. **Don't hardcode credentials** - Use environment variables
9. **Don't forget activity logging** - Track all important events
10. **Don't skip export error handling** - Mark as `export_failed` on errors

---

## 📝 Implementation Checklist

### Phase 1: Database
- [ ] Create new Prisma schema
- [ ] Run migration
- [ ] Verify all models created

### Phase 2: Core Processing
- [ ] Implement transcript analysis service
- [ ] Add 4-pass LLM processing
- [ ] Add context classification
- [ ] Add insight deduplication
- [ ] Add status tracking
- [ ] Add activity logging

### Phase 3: Slack UI
- [ ] Implement App Home view
- [ ] Create upload modal
- [ ] Add settings modal
- [ ] Add transcript list view
- [ ] Add insights list view
- [ ] Add event handlers

### Phase 4: Settings
- [ ] Model configuration CRUD
- [ ] Import source configuration
- [ ] Export destination configuration
- [ ] User preferences

### Phase 5: Export
- [ ] Airtable integration
- [ ] Linear integration
- [ ] Notion integration
- [ ] Jira integration
- [ ] Google Sheets integration

### Phase 6: Testing
- [ ] Upload test
- [ ] Processing test
- [ ] Insight extraction test
- [ ] Export test
- [ ] Error handling test

---

## 🚀 Railway Deployment

### New Railway Instance Required

You'll need a **new Railway instance** for this rebuild:

1. **Why a new instance?**
   - Fresh start with clean configuration
   - No conflicts with old architecture
   - Better organization and monitoring

2. **Create New Railway Project**:
   ```bash
   railway login
   railway init
   ```

3. **Add PostgreSQL Database**:
   ```bash
   railway add postgresql
   ```
   - Railway will automatically provision and set `DATABASE_URL`

4. **Set Environment Variables**:
   ```bash
   railway variables set SLACK_BOT_TOKEN=xoxb-your-token
   railway variables set SLACK_SIGNING_SECRET=your-secret
   railway variables set ANTHROPIC_API_KEY=sk-ant-your-key
   railway variables set OPENAI_API_KEY=sk-your-openai-key
   railway variables set PORT=5000
   railway variables set NODE_ENV=production
   railway variables set LOG_LEVEL=info
   ```

5. **Deploy**:
   ```bash
   git push railway main
   ```

6. **Get Railway URL**:
   ```bash
   railway domain
   ```
   Example: `https://meetyai-production.up.railway.app`

### Update Slack App Configuration

Once deployed, update your Slack app:

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Select MeetyAI app
3. Update **Event Subscriptions** Request URL:
   - `https://your-railway-url.up.railway.app/slack/events`
4. Update **Interactivity & Shortcuts** Request URL:
   - `https://your-railway-url.up.railway.app/slack/events`
5. Save Changes

### Cron Jobs for Imports

Railway doesn't have built-in cron. Options:

1. **Use a Cron Service** (Recommended):
   - [cron-job.org](https://cron-job.org)
   - [EasyCron](https://www.easycron.com)
   - Hit endpoint: `POST /api/cron/import-transcripts` every hour

2. **Self-hosted with node-cron**:
   - Add `node-cron` to the app
   - Runs inside the Railway container

3. **GitHub Actions**:
   - Scheduled workflow hits import endpoint
   - Free for public repos

### Environment Variables Reference

Required:
- `DATABASE_URL` - PostgreSQL connection (auto-set by Railway)
- `SLACK_BOT_TOKEN` - Slack bot token
- `SLACK_SIGNING_SECRET` - Slack signing secret
- `ANTHROPIC_API_KEY` - For Claude Sonnet 4.5
- `OPENAI_API_KEY` - For GPT-5
- `PORT` - Server port (default: 5000)

Optional:
- `NODE_ENV` - Environment (development/production)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)
- `ENCRYPTION_KEY` - For encrypting API keys (auto-generated if not set)

---

END OF SPECIFICATION
