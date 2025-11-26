#!/usr/bin/env bash

set -e

# Generate Prisma client before building
echo "Generating Prisma client..."
npx prisma generate

# Build the Mastra application
echo "Building Mastra application..."
mastra build

# Copy Prisma client to output for deployment
echo "Copying Prisma client to build output..."
mkdir -p .mastra/output/node_modules/.prisma
mkdir -p .mastra/output/node_modules/@prisma

# Copy the generated Prisma client
if [ -d "node_modules/.prisma" ]; then
  cp -r node_modules/.prisma/* .mastra/output/node_modules/.prisma/
  echo "✓ Copied .prisma client"
fi

if [ -d "node_modules/@prisma" ]; then
  cp -r node_modules/@prisma/* .mastra/output/node_modules/@prisma/
  echo "✓ Copied @prisma client"
fi

echo "Build complete!"
