# MeetyAI Rebuild

AI-powered meeting transcript analysis with dual-model architecture (Claude Sonnet 4.5 + GPT-5).

## 🚀 Features

- **Dual-AI Processing**: Claude Sonnet 4.5 for analysis + GPT-5 for writing
- **Slack Integration**: Native Slack app with modals and views
- **Custom Context**: Define your own pain points and insight examples
- **Import Sources**: Automatic transcript imports from Zoom, Fireflies, etc.
- **Export Destinations**: Zapier-style field mapping to Airtable, Linear, Notion, Jira, Google Sheets
- **4-Pass Analysis**: Comprehensive insight extraction with deduplication

## 📋 Requirements

- Node.js 20.9.0+
- PostgreSQL database
- Slack workspace and app
- Anthropic API key (Claude Sonnet 4.5)
- OpenAI API key (GPT-5)

## 🛠️ Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/eugene-nechvoloda/MeetyAI-Rebuild.git
   cd MeetyAI-Rebuild
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Set up database**:
   ```bash
   npm run db:push
   ```

5. **Run development server**:
   ```bash
   npm run dev
   ```

## 🚢 Deployment

See [REBUILD_SPECIFICATION.md](./REBUILD_SPECIFICATION.md) for complete deployment instructions to Railway.

## 📖 Documentation

- [Complete Specification](./REBUILD_SPECIFICATION.md) - Full system specification
- Database schema with 11 models
- Dual-AI processing architecture
- Settings configuration guide

## 🏗️ Architecture

```
MeetyAI-Rebuild/
├── src/
│   ├── index.ts              # Server entry point
│   ├── slack/
│   │   ├── handlers.ts       # Event handlers
│   │   ├── views/            # UI views
│   │   └── modals/           # Modal handlers
│   ├── services/
│   │   ├── transcriptProcessor.ts  # Dual-AI processing
│   │   ├── importService.ts        # Import sources
│   │   └── exportService.ts        # Export destinations
│   └── utils/
│       └── encryption.ts     # API key encryption
└── prisma/
    └── schema.prisma         # Database schema
```

## 🤖 AI Models

- **Analysis**: Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- **Writing**: GPT-5 Preview (`gpt-5-preview`)
- **Hardcoded for MVP**: Research depth 0.7, Temperature 0.35

## 📝 License

MIT

## 🙋 Support

For issues and questions, please open an issue on GitHub.
