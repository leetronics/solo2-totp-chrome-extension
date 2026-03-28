#!/usr/bin/env bash
# Install the SoloKeys TOTP native messaging host for Chrome.
#
# Usage:
#   ./install.sh <extension-id>
#
# Find your extension ID at chrome://extensions (the long hex string
# shown under the extension name when "Developer mode" is on).

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "Usage: $0 <extension-id>"
    echo ""
    echo "Find your extension ID at chrome://extensions"
    exit 1
fi

EXT_ID="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="$SCRIPT_DIR/host.py"
MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/com.solokeys.totp.json"

# Make host executable
chmod +x "$HOST_PATH"

# Check Python and fido2
if ! python3 -c "import fido2.hid" 2>/dev/null; then
    echo "Installing fido2 Python package..."
    pip3 install fido2
fi

# Write the native host manifest
mkdir -p "$MANIFEST_DIR"
cat > "$MANIFEST_PATH" <<EOF
{
    "name": "com.solokeys.totp",
    "description": "SoloKeys TOTP native messaging host",
    "path": "$HOST_PATH",
    "type": "stdio",
    "allowed_origins": [
        "chrome-extension://${EXT_ID}/"
    ]
}
EOF

echo "Installed native host manifest to: $MANIFEST_PATH"
echo "Host script: $HOST_PATH"
echo "Extension ID: $EXT_ID"
echo ""
echo "Done. Reload the extension in Chrome to apply."
