-- MeetyAI Database Migration
-- Adds SystemInstruction table and new fields to ExportConfig and KnowledgeSource

-- Create SystemInstruction table
CREATE TABLE IF NOT EXISTS "SystemInstruction" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    examples TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for SystemInstruction
CREATE INDEX IF NOT EXISTS "SystemInstruction_user_id_idx" ON "SystemInstruction"(user_id);
CREATE INDEX IF NOT EXISTS "SystemInstruction_category_idx" ON "SystemInstruction"(category);
CREATE INDEX IF NOT EXISTS "SystemInstruction_enabled_idx" ON "SystemInstruction"(enabled);

-- Add new columns to ExportConfig (if they don't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='ExportConfig' AND column_name='database_id') THEN
        ALTER TABLE "ExportConfig" ADD COLUMN database_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='ExportConfig' AND column_name='sheet_id') THEN
        ALTER TABLE "ExportConfig" ADD COLUMN sheet_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='ExportConfig' AND column_name='api_endpoint') THEN
        ALTER TABLE "ExportConfig" ADD COLUMN api_endpoint TEXT;
    END IF;
END $$;

-- Add new columns to KnowledgeSource (if they don't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='KnowledgeSource' AND column_name='mcp_server_url') THEN
        ALTER TABLE "KnowledgeSource" ADD COLUMN mcp_server_url TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='KnowledgeSource' AND column_name='mcp_config') THEN
        ALTER TABLE "KnowledgeSource" ADD COLUMN mcp_config JSONB;
    END IF;
END $$;

-- Verify tables exist
SELECT 'Migration completed successfully!' as status;
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('SystemInstruction', 'ExportConfig', 'KnowledgeSource')
ORDER BY table_name;
