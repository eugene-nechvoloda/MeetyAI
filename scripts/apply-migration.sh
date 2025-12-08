#!/bin/bash
# Production Database Migration Script
# Applies schema changes for SystemInstruction table and updated fields

set -e  # Exit on error

echo "=========================================="
echo "MeetyAI Database Migration"
echo "=========================================="
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL is not set"
    echo ""
    echo "Please run this script in your Replit Shell where environment variables are available."
    echo "Go to: Replit → Shell tab → Run: bash scripts/apply-migration.sh"
    exit 1
fi

echo "✓ DATABASE_URL is set"
echo ""

# Show what will be created/modified
echo "📋 Schema Changes:"
echo "  • Creating new table: SystemInstruction"
echo "  • Adding to ExportConfig: database_id, sheet_id, api_endpoint"
echo "  • Adding to KnowledgeSource: mcp_server_url, mcp_config"
echo ""

# Check if migrations directory exists
if [ ! -d "prisma/migrations" ]; then
    echo "📁 Creating migrations directory..."
    mkdir -p prisma/migrations
fi

# Use db push for production (safer, no migration files)
echo "🚀 Applying schema changes to database..."
echo ""

npx prisma db push --accept-data-loss

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ Migration completed successfully!"
    echo "=========================================="
    echo ""
    echo "📊 New tables/fields are now available:"
    echo "  ✓ SystemInstruction table"
    echo "  ✓ ExportConfig.database_id (Notion)"
    echo "  ✓ ExportConfig.sheet_id (Google Sheets)"
    echo "  ✓ ExportConfig.api_endpoint"
    echo "  ✓ KnowledgeSource.mcp_server_url"
    echo "  ✓ KnowledgeSource.mcp_config"
    echo ""
    echo "🔄 Next steps:"
    echo "  1. Restart your application"
    echo "  2. Test Settings button in Slack"
    echo "  3. Test transcript upload"
    echo ""
else
    echo ""
    echo "❌ Migration failed!"
    echo ""
    echo "Common issues:"
    echo "  • Database connection timeout"
    echo "  • Schema conflicts"
    echo "  • Permissions issues"
    echo ""
    echo "Try running: npx prisma db push --help"
    exit 1
fi
