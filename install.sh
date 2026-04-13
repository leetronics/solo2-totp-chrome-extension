#!/bin/bash
#
# install.sh - Automated installation helper for SoloKeys Vault
#
# Usage:
#   ./install.sh             - Build and print Chrome + Firefox install steps
#   ./install.sh --chrome    - Build and print Chrome install steps only
#   ./install.sh --firefox   - Build and print Firefox install steps only
#   ./install.sh --clean     - Clean first, then rebuild requested targets
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
CHROME_DIST_DIR="$SCRIPT_DIR/dist"
FIREFOX_DIST_DIR="$SCRIPT_DIR/dist-firefox"
TARGET="all"
CLEAN=0

echo -e "${BLUE}SoloKeys Vault Extension Installer${NC}"
echo "=================================="
echo ""

while [ $# -gt 0 ]; do
    case "$1" in
        --chrome)
            TARGET="chrome"
            ;;
        --firefox)
            TARGET="firefox"
            ;;
        --clean)
            CLEAN=1
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: ./install.sh [--chrome] [--firefox] [--clean]"
            exit 1
            ;;
    esac
    shift
done

detect_chrome() {
    CHROME_PATH=""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if [ -d "/Applications/Google Chrome.app" ]; then
            CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        elif [ -d "/Applications/Chromium.app" ]; then
            CHROME_PATH="/Applications/Chromium.app/Contents/MacOS/Chromium"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v google-chrome &> /dev/null; then
            CHROME_PATH="google-chrome"
        elif command -v chromium-browser &> /dev/null; then
            CHROME_PATH="chromium-browser"
        elif command -v chromium &> /dev/null; then
            CHROME_PATH="chromium"
        fi
    fi
    if [ -n "$CHROME_BIN" ]; then
        CHROME_PATH="$CHROME_BIN"
    fi
}

detect_firefox() {
    FIREFOX_PATH=""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if [ -d "/Applications/Firefox.app" ]; then
            FIREFOX_PATH="/Applications/Firefox.app/Contents/MacOS/firefox"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v firefox &> /dev/null; then
            FIREFOX_PATH="firefox"
        fi
    fi

    if [ -n "$FIREFOX_BIN" ]; then
        FIREFOX_PATH="$FIREFOX_BIN"
    fi
}

build_extension() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Error: Node.js is required but not installed.${NC}"
        echo "Please install Node.js or manually build the extension."
        exit 1
    fi

    if [ "$CLEAN" -eq 1 ]; then
        node "$SCRIPT_DIR/build.js" --clean
    fi

    case "$TARGET" in
        chrome)
            node "$SCRIPT_DIR/build.js" --chrome
            ;;
        firefox)
            node "$SCRIPT_DIR/build.js" --firefox
            ;;
        *)
            node "$SCRIPT_DIR/build.js"
            ;;
    esac
}

open_chrome_extensions() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if ! open -a "Google Chrome" "chrome://extensions/" 2>/dev/null; then
            if ! open -a "Chromium" "chrome://extensions/" 2>/dev/null; then
                if [ -n "$CHROME_PATH" ]; then
                    "$CHROME_PATH" "chrome://extensions/" &
                fi
            fi
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -n "$CHROME_PATH" ]; then
            "$CHROME_PATH" "chrome://extensions/" &
        fi
    fi
}

open_firefox_debugging() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if ! open -a "Firefox" "about:debugging#/runtime/this-firefox" 2>/dev/null; then
            if [ -n "$FIREFOX_PATH" ]; then
                "$FIREFOX_PATH" "about:debugging#/runtime/this-firefox" &
            fi
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -n "$FIREFOX_PATH" ]; then
            "$FIREFOX_PATH" "about:debugging#/runtime/this-firefox" &
        fi
    fi
}

build_extension
detect_chrome
detect_firefox

if [ "$TARGET" != "firefox" ] && [ ! -d "$CHROME_DIST_DIR" ]; then
    echo -e "${RED}Error: Chrome build output not found at $CHROME_DIST_DIR${NC}"
    exit 1
fi

if [ "$TARGET" != "chrome" ] && [ ! -d "$FIREFOX_DIST_DIR" ]; then
    echo -e "${RED}Error: Firefox build output not found at $FIREFOX_DIST_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Extension build is ready to install.${NC}"
echo ""

if [ "$TARGET" != "firefox" ]; then
    cat << EOF
Chrome / Chromium:
==================
Developer mode:
  1. Open Chrome: chrome://extensions/
  2. Enable "Developer mode"
  3. Click "Load unpacked"
  4. Select: $CHROME_DIST_DIR

Release / distribution:
  - Upload solokeys-vault-chrome-v*.zip to the Chrome Web Store
  - Or drag solokeys-vault-chrome-v*.crx onto chrome://extensions/

EOF
fi

if [ "$TARGET" != "chrome" ]; then
    cat << EOF
Firefox:
========
Local testing:
  1. Open Firefox: about:debugging#/runtime/this-firefox
  2. Click "Load Temporary Add-on"
  3. Select: $FIREFOX_DIST_DIR/manifest.json

Release / distribution:
  - Sign solokeys-vault-firefox-v*.xpi for release use

EOF
fi

if [ "$TARGET" = "chrome" ] || [ "$TARGET" = "all" ]; then
    if [ -n "$CHROME_PATH" ]; then
        read -p "Open Chrome extensions page now? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            open_chrome_extensions
        fi
    fi
fi

if [ "$TARGET" = "firefox" ] || [ "$TARGET" = "all" ]; then
    if [ -n "$FIREFOX_PATH" ]; then
        read -p "Open Firefox add-on debugging page now? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            open_firefox_debugging
        fi
    fi
fi

echo -e "${GREEN}Installation preparation complete.${NC}"
echo "See README.md and the generated INSTALL-*.md for packaging details."
