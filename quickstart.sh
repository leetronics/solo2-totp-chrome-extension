#!/bin/bash
#
# quickstart.sh - Quick start script for developers
# Builds the extension packages and prints browser-specific load steps
#

set -e

echo "SoloKeys Vault Extension - Quick Start"
echo "======================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "✓ Node.js found: $(node --version)"

# Install dependencies if needed
if [ ! -d "node_modules" ] && [ -f "package.json" ]; then
    echo ""
    echo "📦 Installing dependencies..."
    npm install
fi

# Build extension
echo ""
echo "🔨 Building extension..."
node build.js

if [ ! -d "dist" ] || [ ! -d "dist-firefox" ]; then
    echo "❌ Build failed"
    exit 1
fi

echo ""
echo "✅ Extension built successfully!"
echo ""

echo "Next steps:"
echo "-----------"
echo ""
echo "Chrome / Chromium:"
echo "  1. Open chrome://extensions/"
echo "  2. Enable 'Developer mode'"
echo "  3. Click 'Load unpacked' and select:"
echo "     $(pwd)/dist"
echo ""
echo "Firefox:"
echo "  1. Open about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on'"
echo "  3. Select:"
echo "     $(pwd)/dist-firefox/manifest.json"
echo ""

echo ""
echo "📚 For more options, run: make help"
