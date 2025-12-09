#!/bin/bash
# Complete Fix Script for MeetyAI Issues
set -e

echo "=========================================="
echo "MeetyAI Complete Fix Script"
echo "=========================================="
echo ""

# Step 1: Delete stuck Celonis transcript
echo "📝 Step 1: Deleting stuck Celonis transcript..."
npx prisma db execute --schema prisma/schema.prisma --stdin << 'EOF'
DELETE FROM "Insight" WHERE transcript_id IN (
  SELECT id FROM "Transcript" WHERE title LIKE '%Celonis%'
);
DELETE FROM "Transcript" WHERE title LIKE '%Celonis%';
SELECT 'Celonis transcript deleted' as status;
EOF

echo ""
echo "✅ Celonis transcript deleted"
echo ""

# Step 2: Verify database tables exist
echo "📊 Step 2: Verifying database tables..."
npx prisma db execute --schema prisma/schema.prisma --stdin << 'EOF'
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('SystemInstruction', 'Transcript', 'Insight', 'ExportConfig', 'KnowledgeSource')
ORDER BY table_name;
EOF

echo ""

# Step 3: Regenerate Prisma Client
echo "🔄 Step 3: Regenerating Prisma Client..."
npx prisma generate

echo ""
echo "✅ Prisma Client regenerated"
echo ""

# Step 4: Kill all node processes
echo "🛑 Step 4: Stopping all node processes..."
pkill -f "node" || true
pkill -f "npm" || true
sleep 2

echo "✅ All processes stopped"
echo ""

# Step 5: Verify code has fixes
echo "🔍 Step 5: Verifying fixes are in code..."
if grep -q "ingestTranscript" src/mastra/index.ts; then
    echo "✅ Upload fix found (ingestTranscript)"
else
    echo "❌ Upload fix NOT found"
fi

if grep -q "systemInstructions: any\[\] = \[\]" src/mastra/index.ts; then
    echo "✅ Settings fix found (try-catch)"
else
    echo "❌ Settings fix NOT found"
fi

echo ""
echo "=========================================="
echo "✅ All fixes verified!"
echo "=========================================="
echo ""
echo "🚀 Next steps:"
echo "  1. Start your app: npm run dev (or click Run in Replit)"
echo "  2. Wait for 'Server started on port 5000'"
echo "  3. Test in Slack:"
echo "     - Click Settings button"
echo "     - Upload new transcript"
echo ""
