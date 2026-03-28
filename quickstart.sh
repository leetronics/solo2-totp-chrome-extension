#!/bin/bash
#
# quickstart.sh - Quick start script for developers
# Builds and loads the extension into Chrome automatically
#

set -e

echo "SoloKeys TOTP Extension - Quick Start"
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

if [ ! -d "dist" ]; then
    echo "❌ Build failed"
    exit 1
fi

echo ""
echo "✅ Extension built successfully!"
echo ""

# Show Chrome paths by platform
echo "Next steps:"
echo "-----------"
echo ""
echo "1. Open Chrome and navigate to: chrome://extensions/"
echo ""
echo "2. Enable 'Developer mode' (toggle in top-right)"
echo ""
echo "3. Click 'Load unpacked' and select:"
echo "   $(pwd)/dist"
echo ""

# Try to open Chrome automatically
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if command -v open &> /dev/null; then
        echo "Opening Chrome..."
        open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || \
        open "chrome://extensions/" 2>/dev/null || true
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v xdg-open &> /dev/null; then
        echo "Opening Chrome..."
        xdg-open "chrome://extensions/" 2>/dev/null || true
    fi
fi

echo ""
echo "📚 For more options, run: make help"