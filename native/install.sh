#!/usr/bin/env bash
# Install the SoloKeys Vault native messaging host manifest for Chrome/Chromium and Firefox.
#
# Usage:
#   ./install.sh --chrome <extension-id>
#   ./install.sh --firefox [extension-id]
#   ./install.sh --both <chrome-extension-id> [firefox-extension-id]
#
# Find your Chrome extension ID at chrome://extensions (the long hex string
# shown under the extension name when "Developer mode" is on).

set -euo pipefail

FIREFOX_EXTENSION_ID_DEFAULT="solokeys-vault@solokeys.dev"

usage() {
    cat <<EOF
Usage:
  $0 --chrome <extension-id>
  $0 --firefox [extension-id]
  $0 --both <chrome-extension-id> [firefox-extension-id]

Examples:
  $0 --chrome abcdefghijklmnopqrstuvwxyzabcdef
  $0 --firefox
  $0 --both abcdefghijklmnopqrstuvwxyzabcdef
EOF
}

if [ $# -lt 1 ]; then
    usage
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="$SCRIPT_DIR/host.py"

# Make host executable
chmod +x "$HOST_PATH"

# Check Python and fido2
if ! python3 -c "import fido2.hid" 2>/dev/null; then
    echo "Installing fido2 Python package..."
    pip3 install fido2
fi

write_chromium_manifest() {
    local ext_id="$1"
    local manifest_dir

    for manifest_dir in \
        "$HOME/.config/google-chrome/NativeMessagingHosts" \
        "$HOME/.config/chromium/NativeMessagingHosts"
    do
        mkdir -p "$manifest_dir"
        cat > "$manifest_dir/com.solokeys.secrets.json" <<EOF
{
    "name": "com.solokeys.secrets",
    "description": "SoloKeys Vault native messaging host",
    "path": "$HOST_PATH",
    "type": "stdio",
    "allowed_origins": [
        "chrome-extension://${ext_id}/"
    ]
}
EOF
        echo "Installed Chromium manifest to: $manifest_dir/com.solokeys.secrets.json"
    done
}

write_firefox_manifest() {
    local ext_id="$1"
    local manifest_dir="$HOME/.mozilla/native-messaging-hosts"

    mkdir -p "$manifest_dir"
    cat > "$manifest_dir/com.solokeys.secrets.json" <<EOF
{
    "name": "com.solokeys.secrets",
    "description": "SoloKeys Vault native messaging host",
    "path": "$HOST_PATH",
    "type": "stdio",
    "allowed_extensions": [
        "$ext_id"
    ]
}
EOF
    echo "Installed Firefox manifest to: $manifest_dir/com.solokeys.secrets.json"
}

case "$1" in
    --chrome)
        if [ $# -ne 2 ]; then
            usage
            exit 1
        fi
        EXT_ID="$2"
        write_chromium_manifest "$EXT_ID"
        echo "Host script: $HOST_PATH"
        echo "Chrome extension ID: $EXT_ID"
        echo ""
        echo "Done. Reload the extension in Chrome or Chromium to apply."
        ;;
    --firefox)
        if [ $# -gt 2 ]; then
            usage
            exit 1
        fi
        EXT_ID="${2:-$FIREFOX_EXTENSION_ID_DEFAULT}"
        write_firefox_manifest "$EXT_ID"
        echo "Host script: $HOST_PATH"
        echo "Firefox extension ID: $EXT_ID"
        echo ""
        echo "Done. Reload the extension in Firefox to apply."
        ;;
    --both)
        if [ $# -lt 2 ] || [ $# -gt 3 ]; then
            usage
            exit 1
        fi
        CHROME_EXT_ID="$2"
        FIREFOX_EXT_ID="${3:-$FIREFOX_EXTENSION_ID_DEFAULT}"
        write_chromium_manifest "$CHROME_EXT_ID"
        write_firefox_manifest "$FIREFOX_EXT_ID"
        echo "Host script: $HOST_PATH"
        echo "Chrome extension ID: $CHROME_EXT_ID"
        echo "Firefox extension ID: $FIREFOX_EXT_ID"
        echo ""
        echo "Done. Reload the extensions in your browsers to apply."
        ;;
    *)
        usage
        exit 1
        ;;
esac
