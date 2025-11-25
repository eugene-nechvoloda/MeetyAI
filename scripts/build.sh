#!/usr/bin/env bash

set -e

# Generate Prisma client before building
echo "Generating Prisma client..."
npx prisma generate

# Build the Mastra application
echo "Building Mastra application..."
exec mastra build
