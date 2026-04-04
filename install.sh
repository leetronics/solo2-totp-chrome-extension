#!/bin/bash
#
# install.sh - Automated installation script for SoloKeys Vault Extension
#
# Usage:
#   ./install.sh           - Install to Chrome (macOS/Linux)
#   ./install.sh --chrome  - Specify Chrome path
#   ./install.sh --clean   - Clean and reinstall
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"

echo -e "${BLUE}SoloKeys Vault Extension Installer${NC}"
echo "=================================="
echo ""

# Check if dist directory exists
if [ ! -d "$DIST_DIR" ]; then
    echo -e "${YELLOW}Extension not built yet. Building now...${NC}"
    
    # Check if node is available
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js is required but not installed.${NC}"
        echo "Please install Node.js or manually build the extension."
        exit 1
    fi
    
    # Build the extension
    node "$SCRIPT_DIR/build.js"
    
    if [ ! -d "$DIST_DIR" ]; then
        echo -e "${RED}Error: Build failed. dist/ directory not created.${NC}"
        exit 1
    fi
fi

# Detect Chrome path
detect_chrome() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if [ -d "/Applications/Google Chrome.app" ]; then
            CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        elif [ -d "/Applications/Chromium.app" ]; then
            CHROME_PATH="/Applications/Chromium.app/Contents/MacOS/Chromium"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v google-chrome &> /dev/null; then
            CHROME_PATH="google-chrome"
        elif command -v chromium-browser &> /dev/null; then
            CHROME_PATH="chromium-browser"
        elif command -v chromium &> /dev/null; then
            CHROME_PATH="chromium"
        fi
    fi
    
    # Allow override from environment or argument
    if [ -n "$CHROME_BIN" ]; then
        CHROME_PATH="$CHROME_BIN"
    fi
}

detect_chrome

if [ -z "$CHROME_PATH" ]; then
    echo -e "${YELLOW}Could not auto-detect Chrome installation.${NC}"
    echo "Please specify Chrome path with: CHROME_BIN=/path/to/chrome ./install.sh"
    echo ""
    echo "Opening manual installation instructions..."
    
    cat << 'EOF'

Manual Installation Instructions:
================================

1. Open Chrome and navigate to: chrome://extensions/

2. Enable "Developer mode" in the top-right corner

3. Click "Load unpacked"

4. Select the dist/ folder from this directory:
   
EOF
    echo "   $DIST_DIR"
    echo ""
    
    # Try to open Chrome extensions page
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "chrome://extensions/" 2>/dev/null || true
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "chrome://extensions/" 2>/dev/null || true
    fi
    
    exit 0
fi

echo -e "${GREEN}Found Chrome at: $CHROME_PATH${NC}"
echo ""

# Check if extension is already installed
EXTENSION_NAME="SoloKeys Vault"

# Function to open Chrome with extensions page
open_chrome_extensions() {
    echo -e "${BLUE}Opening Chrome Extensions page...${NC}"
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - use open command
        open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || \
        open -a "Chromium" "chrome://extensions/" 2>/dev/null || \
        "$CHROME_PATH" "chrome://extensions/" &
    else
        # Linux
        "$CHROME_PATH" "chrome://extensions/" &
    fi
}

echo -e "${GREEN}✓ Extension is ready to install!${NC}"
echo ""
echo "Extension location: $DIST_DIR"
echo ""

# Provide instructions
cat << EOF
Installation Options:
====================

Option 1 - Chrome Web Store (Recommended for users):
  1. Upload solokeys-vault-*.zip to Chrome Web Store
  2. Publish and distribute the extension ID

Option 2 - Developer Mode (For testing/development):
  1. Open Chrome: chrome://extensions/
  2. Enable "Developer mode"
  3. Click "Load unpacked"
  4. Select: $DIST_DIR

Option 3 - Drag and Drop (Quick install):
  1. Open Chrome: chrome://extensions/
  2. Enable "Developer mode"
  3. Drag solokeys-vault-*.crx onto the page

Option 4 - Enterprise/Policy:
  Use the generated .crx file with Chrome Enterprise policies

EOF

# Offer to open Chrome
read -p "Open Chrome Extensions page now? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    open_chrome_extensions
    echo -e "${GREEN}Chrome should open shortly.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Enable 'Developer mode' in Chrome"
    echo "  2. Click 'Load unpacked'"
    echo "  3. Select the dist/ folder"
fi

echo ""
echo -e "${GREEN}Installation preparation complete!${NC}"
echo ""
echo "For more information, see:"
echo "  - README.md"
echo "  - INSTALL-*.md (generated after build)"
