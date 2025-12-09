# MeetyAI Migration Guide - Simplified Architecture

## 🎯 What Changed

### Removed (Complexity):
- ❌ Mastra framework
- ❌ Inngest workflow system
- ❌ Complex workflow orchestration
- ❌ Replit hosting

### Added (Simplicity):
- ✅ Simple Express + Slack Bolt server
- ✅ Direct Anthropic API calls
- ✅ Background async processing
- ✅ Railway deployment

---

## 📁 New Architecture

```
src/
├── index.ts                           # Main server entry
├── slack/
│   ├── handlers.ts                    # Slack event handlers
│   ├── modals/
│   │   └── uploadTranscript.ts        # Upload modal handler
│   └── views/
│       ├── appHome.ts                 # App home view builder
│       └── uploadModal.ts             # Upload modal view
└── services/
    └── transcriptProcessor.ts         # Direct Anthropic processing
```

---

## 🚀 Deploy to Railway

### 1. Install Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### 2. Create New Project

```bash
railway init
```

### 3. Add PostgreSQL Database

```bash
railway add postgresql
```

Railway will automatically provision a database and set `DATABASE_URL`.

### 4. Set Environment Variables

```bash
railway variables set SLACK_BOT_TOKEN=xoxb-your-token
railway variables set SLACK_SIGNING_SECRET=your-secret
railway variables set ANTHROPIC_API_KEY=sk-ant-your-key
railway variables set PORT=5000
railway variables set NODE_ENV=production
```

### 5. Deploy

```bash
git push railway railway-migration:main
```

### 6. Get Your Railway URL

```bash
railway domain
```

Example: `https://your-app.up.railway.app`

---

## 🔄 Update Slack App

Once deployed to Railway, update your Slack app configuration:

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Select your MeetyAI app
3. Update **Event Subscriptions** Request URL:
   - Old: `https://your-replit.repl.co/slack/events`
   - New: `https://your-app.up.railway.app/slack/events`

4. Update **Interactivity & Shortcuts** Request URL:
   - Old: `https://your-replit.repl.co/slack/events`
   - New: `https://your-app.up.railway.app/slack/events`

5. Click "Save Changes"

---

## 🧪 Test the Migration

After deploying:

1. Open Slack and go to your MeetyAI app
2. Upload a transcript (file, text, or link)
3. Check the status - should progress: Pending → Analyzing → Completed
4. Verify insights appear
5. Test re-analysis button

---

## 🔍 Debugging

### Check Logs

```bash
railway logs
```

### Run Database Migrations

```bash
railway run npx prisma db push
```

### Connect to Database

```bash
railway run npx prisma studio
```

---

## 💡 Key Benefits

1. **Simpler**: No complex workflows, just async functions
2. **Faster**: Direct API calls, no middleware
3. **Debuggable**: Clear error logs, easy to trace
4. **Scalable**: Railway handles auto-scaling
5. **Cheaper**: No Replit costs, Railway free tier available

---

## 🔄 Rollback Plan

If issues occur, you can rollback to the previous architecture:

```bash
git checkout claude/redesign-meetyai-architecture-011jK5Sj2LoG9C51QD23C3s3
git push railway HEAD:main --force
```

---

## 📝 Notes

- Database schema unchanged - all your data is preserved
- Slack UI unchanged - all modals and views work the same
- Processing logic simplified but functionally equivalent
- Railway provides better logging and monitoring than Replit

---

## ✅ Success Criteria

Migration is successful when:
- [ ] Railway deployment completes
- [ ] Slack events are received
- [ ] File upload works
- [ ] Transcripts progress from Pending → Completed
- [ ] Insights are extracted and displayed
- [ ] Re-analysis works
- [ ] No errors in Railway logs
